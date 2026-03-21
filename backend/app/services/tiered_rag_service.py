"""
Tiered RAG Service following RAG_DESIGN.md principles.

Architecture:
- Tier 0 (Cold): Raw UAC archives in filesystem - never queried directly
- Tier 1 (Warm): Cleaned, chunked text in SQLite with rich metadata
- Tier 2 (Vector): Embeddings in ChromaDB - no text storage, ANN search only
- Tier 3 (Hot): In-memory LRU cache for frequently accessed chunks
- BM25 Index: Keyword-based search for exact matches

Design principles:
- Expensive operations happen at ingestion time
- Query flow: Hot Cache → Hybrid Search (BM25+Vector) → Cross-Encoder Rerank → Context Assembly
- Pre-filtering is OPTIONAL (can exclude relevant results)
- Cross-encoder reranking provides accurate relevance scoring
- Top 5-10 high-quality chunks beat top 50 mediocre ones

Enhanced features:
- BM25 keyword search for exact matches (spec codes, file paths, IPs)
- Query expansion with forensic domain knowledge
- Hybrid retrieval combining BM25 and vector results
- Cross-encoder reranking for precision
"""
from pathlib import Path
from typing import Any, Optional
from datetime import datetime
from collections import OrderedDict
import hashlib
import re
import logging
import gevent
import tiktoken
import chromadb
from chromadb.config import Settings

# Fast embedding service with GPU acceleration
from .embedding_service import get_embedding_service

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------ #
#   Module-level ChromaDB singleton + factory
# ------------------------------------------------------------------ #
_chroma_client = None
_chroma_settings = Settings(anonymized_telemetry=False)


def get_chroma_client(persist_dir=None):
    """Return the process-wide ChromaDB PersistentClient singleton."""
    global _chroma_client
    if _chroma_client is None:
        if persist_dir is None:
            from flask import current_app
            persist_dir = current_app.config.get("CHROMA_PERSIST_DIR", "chroma_db")
        path = str(persist_dir)
        Path(path).mkdir(parents=True, exist_ok=True)
        _chroma_client = chromadb.PersistentClient(path=path, settings=_chroma_settings)
    return _chroma_client


def get_tiered_rag_service():
    """Return a TieredRAGService backed by the shared ChromaDB client."""
    from flask import current_app
    return TieredRAGService(
        chroma_persist_dir=current_app.config.get("CHROMA_PERSIST_DIR", Path.home() / ".uac-ai" / "chroma")
    )

try:
    from rank_bm25 import BM25Okapi
    HAS_BM25 = True
except ImportError:
    HAS_BM25 = False

# Cross-encoder for reranking (lazy-loaded to avoid torch import at startup)
HAS_CROSS_ENCODER = False
_cross_encoder_class = None

def _get_cross_encoder_class():
    global HAS_CROSS_ENCODER, _cross_encoder_class
    if _cross_encoder_class is None:
        try:
            from sentence_transformers import CrossEncoder
            _cross_encoder_class = CrossEncoder
            HAS_CROSS_ENCODER = True
        except ImportError:
            HAS_CROSS_ENCODER = False
    return _cross_encoder_class

from app.models import db, Chunk, Session, Entity
from app.services.entity_extractor import get_entity_extractor


def _strip_nul(s: str) -> str:
    """Remove NUL bytes that PostgreSQL TEXT columns reject."""
    return s.replace('\x00', '') if s else s


# Forensic domain query expansion dictionary
FORENSIC_QUERY_EXPANSION = {
    # User-related
    'user': ['username', 'uid', 'gid', 'account', 'passwd', 'shadow', 'home'],
    'users': ['username', 'uid', 'gid', 'account', 'passwd', 'shadow', 'home'],
    'login': ['auth', 'session', 'ssh', 'pam', 'tty', 'pts', 'lastlog'],
    'account': ['user', 'passwd', 'shadow', 'uid', 'shell'],
    
    # Authentication
    'password': ['passwd', 'shadow', 'hash', 'credential', 'auth'],
    'ssh': ['sshd', 'authorized_keys', 'known_hosts', 'id_rsa', 'pubkey'],
    'sudo': ['sudoers', 'root', 'privilege', 'elevation'],
    
    # Network  
    'ip': ['address', 'interface', 'inet', 'network', 'connection'],
    'port': ['listen', 'socket', 'netstat', 'connection', 'service'],
    'connection': ['netstat', 'socket', 'established', 'listen', 'port'],
    'network': ['interface', 'ip', 'dns', 'resolv', 'hosts', 'route'],
    
    # Persistence
    'cron': ['crontab', 'scheduled', 'job', 'timer', 'periodic'],
    'persistence': ['cron', 'systemd', 'init', 'startup', 'autorun', 'service'],
    'service': ['systemd', 'init', 'daemon', 'unit', 'enabled'],
    
    # Processes
    'process': ['pid', 'ppid', 'ps', 'cmdline', 'running', 'executable'],
    'running': ['process', 'active', 'current', 'live'],
    
    # Malicious indicators
    'suspicious': ['malware', 'backdoor', 'rootkit', 'unauthorized', 'anomaly'],
    'malware': ['virus', 'trojan', 'backdoor', 'suspicious', 'malicious'],
    'backdoor': ['reverse', 'shell', 'listener', 'bind', 'nc', 'netcat'],
    
    # Files
    'file': ['path', 'directory', 'folder', 'inode', 'permission'],
    'permission': ['chmod', 'chown', 'mode', 'access', 'rwx'],
    'modified': ['mtime', 'changed', 'timestamp', 'recent'],
}


class BM25Index:
    """BM25 index for keyword-based search."""
    
    def __init__(self):
        self.documents: list[str] = []
        self.doc_ids: list[str] = []
        self.bm25: Optional[BM25Okapi] = None
    
    def build(self, documents: list[tuple[str, str]]) -> None:
        """Build BM25 index from (chunk_id, content) pairs."""
        if not HAS_BM25:
            return
        
        self.doc_ids = [doc_id for doc_id, _ in documents]
        self.documents = [content for _, content in documents]
        
        # Tokenize documents
        tokenized = [self._tokenize(doc) for doc in self.documents]
        self.bm25 = BM25Okapi(tokenized)
    
    def _tokenize(self, text: str) -> list[str]:
        """Simple tokenization for BM25."""
        # Lowercase and split on non-alphanumeric
        return re.findall(r'\b\w+\b', text.lower())
    
    def search(self, query: str, top_k: int = 20) -> list[tuple[str, float]]:
        """Search BM25 index, return (chunk_id, score) pairs."""
        if not HAS_BM25 or self.bm25 is None:
            return []
        
        tokenized_query = self._tokenize(query)
        scores = self.bm25.get_scores(tokenized_query)
        
        # Get top-k results
        results = []
        for i, score in enumerate(scores):
            if score > 0:
                results.append((self.doc_ids[i], float(score)))
        
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:top_k]


class LRUCache:
    """Simple LRU cache for Tier 3 (hot) storage."""
    
    def __init__(self, max_size: int = 1000):
        self.cache: OrderedDict[str, tuple[str, datetime]] = OrderedDict()
        self.max_size = max_size
        self.hits = 0
        self.misses = 0
    
    def get(self, key: str) -> Optional[str]:
        """Get item from cache, updating access order."""
        if key in self.cache:
            self.cache.move_to_end(key)
            self.hits += 1
            return self.cache[key][0]
        self.misses += 1
        return None
    
    def put(self, key: str, value: str) -> None:
        """Add item to cache, evicting LRU if full."""
        if key in self.cache:
            self.cache.move_to_end(key)
        else:
            if len(self.cache) >= self.max_size:
                self.cache.popitem(last=False)
            self.cache[key] = (value, datetime.utcnow())
    
    def get_stats(self) -> dict:
        """Get cache statistics."""
        total = self.hits + self.misses
        return {
            "size": len(self.cache),
            "max_size": self.max_size,
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": self.hits / total if total > 0 else 0
        }


class TieredRAGService:
    """
    Production RAG service with tiered storage.
    
    Follows RAG_DESIGN.md constraints:
    - Index ALL text files, not just known forensic ones
    - Chunking by ~512 tokens (model-agnostic)
    - Pre-filtering before vector search
    - Minimal context to LLM
    """
    
    # Singleton instances
    _chroma_client = None
    _hot_cache = None
    _tokenizer = None
    
    # File types to index (anything text-based)
    TEXT_EXTENSIONS = {
        '.txt', '.log', '.conf', '.cfg', '.ini', '.json', '.xml',
        '.csv', '.sh', '.bash', '.py', '.pl', '.rb', '.ps1',
        '.html', '.htm', '.md', '.yaml', '.yml', '.toml',
        '.bashrc', '.bash_history', '.zsh_history', '.profile',
        '.service', '.socket', '.timer', '.mount',
        '', # extensionless files (common in Linux)
    }
    
    # Binary files to extract metadata from (future)
    BINARY_EXTENSIONS = {
        '.exe', '.dll', '.so', '.elf', '.bin', '.o', '.a',
        '.tar', '.gz', '.bz2', '.xz', '.zip', '.7z', '.rar',
        '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
        '.db', '.sqlite', '.sqlite3', '.mdb',
        '.pyc', '.pyo', '.class', '.jar',
        '.deb', '.rpm', '.pkg', '.msi', '.dmg',
    }
    
    # Source type classification for pre-filtering
    SOURCE_TYPE_PATTERNS = {
        'users': ['passwd', 'shadow', 'group', 'sudoers', 'home/', 'users/'],
        'auth': ['auth.log', 'secure', 'login', 'pam', 'ssh', 'authorized_keys'],
        'network': ['hosts', 'resolv', 'interfaces', 'network', 'iptables', 'firewall', 'netstat'],
        'persistence': ['cron', 'systemd', 'init', 'rc.local', 'startup', 'autorun'],
        'logs': ['.log', 'syslog', 'messages', 'journal', 'audit', 'dmesg'],
        'config': ['.conf', '.cfg', '.ini', '.yaml', '.yml', '.toml', 'config'],
        'process': ['ps', 'proc/', 'lsof', 'process'],
        'filesystem': ['fstab', 'mtab', 'mount', 'disk', 'lsblk'],
    }
    
    def __init__(self, chroma_persist_dir: Path, chunk_size: int = 512, 
                 chunk_overlap: int = 50, hot_cache_size: int = 1000):
        """
        Initialize tiered RAG service.
        
        Args:
            chroma_persist_dir: Directory for ChromaDB persistence (Tier 2)
            chunk_size: Target chunk size in tokens
            chunk_overlap: Overlap between chunks in tokens
            hot_cache_size: Max items in hot cache (Tier 3)
        """
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        
        # Initialize Tier 2 (Vector Index)
        if TieredRAGService._chroma_client is None:
            TieredRAGService._chroma_client = get_chroma_client(chroma_persist_dir)
        self.chroma = TieredRAGService._chroma_client
        
        # Initialize Tier 3 (Hot Cache)
        if TieredRAGService._hot_cache is None:
            TieredRAGService._hot_cache = LRUCache(max_size=hot_cache_size)
        self.hot_cache = TieredRAGService._hot_cache
        
        # Initialize tokenizer for accurate token counting
        if TieredRAGService._tokenizer is None:
            TieredRAGService._tokenizer = tiktoken.get_encoding("cl100k_base")
        self.tokenizer = TieredRAGService._tokenizer
        
        # BM25 indexes per session (lazy loaded)
        self._bm25_indexes: dict[str, BM25Index] = {}
        
        # Cross-encoder for reranking (lazy loaded)
        self._cross_encoder = None
    
    def _get_cross_encoder(self):
        """Lazy load cross-encoder model for reranking."""
        if self._cross_encoder is None:
            CE = _get_cross_encoder_class()
            if CE is not None:
                self._cross_encoder = CE('cross-encoder/ms-marco-MiniLM-L-6-v2')
        return self._cross_encoder
    
    def _rerank_with_cross_encoder(self, query: str, chunks: list[dict], top_k: int = 10) -> list[dict]:
        """
        Rerank chunks using cross-encoder for more accurate relevance scoring.
        
        Cross-encoders jointly encode query and document, providing much more
        accurate relevance scores than bi-encoder similarity.
        
        Args:
            query: User query
            chunks: List of chunk dicts with 'content' key
            top_k: Number of top chunks to return
            
        Returns:
            Top chunks reranked by cross-encoder score
        """
        encoder = self._get_cross_encoder()
        
        if encoder is None or not chunks:
            # Fallback: return chunks as-is sorted by existing score
            return sorted(chunks, key=lambda x: x.get('combined_score', 0), reverse=True)[:top_k]
        
        # Prepare query-document pairs for cross-encoder
        pairs = [(query, chunk.get('content', '')) for chunk in chunks]
        
        # Get cross-encoder scores
        scores = encoder.predict(pairs)
        
        # Add cross-encoder scores to chunks
        for chunk, score in zip(chunks, scores):
            chunk['cross_encoder_score'] = float(score)
        
        # Sort by cross-encoder score (higher is better)
        reranked = sorted(chunks, key=lambda x: x['cross_encoder_score'], reverse=True)
        
        return reranked[:top_k]
    
    def _expand_query(self, query: str) -> str:
        """
        Expand query with domain-specific terms for better retrieval.
        
        Example: "users" -> "users username uid gid account passwd shadow home"
        """
        words = query.lower().split()
        expanded_words = set(words)
        
        for word in words:
            if word in FORENSIC_QUERY_EXPANSION:
                expanded_words.update(FORENSIC_QUERY_EXPANSION[word])
        
        return ' '.join(expanded_words)
    
    def _get_bm25_index(self, session_id: str) -> BM25Index:
        """Get or build BM25 index for a session."""
        if session_id in self._bm25_indexes:
            return self._bm25_indexes[session_id]
        
        # Build index from session chunks
        session = Session.query.filter_by(session_id=session_id).first()
        if not session:
            return BM25Index()
        
        chunks = Chunk.query.filter_by(session_id=session.id).all()
        documents = [(c.chunk_id, c.content) for c in chunks]
        
        index = BM25Index()
        index.build(documents)
        
        self._bm25_indexes[session_id] = index
        return index
    
    def _count_tokens(self, text: str) -> int:
        """Count tokens in text."""
        return len(self.tokenizer.encode(text))
    
    def _chunk_text(self, text: str, source_file: str, session_id: str = "") -> list[dict]:
        """
        Chunk text into ~512 token blocks with overlap.
        
        Returns list of chunk dicts with content and metadata.
        
        Args:
            text: The text content to chunk
            source_file: Source file path for metadata
            session_id: Session ID to include in chunk_id for uniqueness across sessions
        """
        tokens = self.tokenizer.encode(text)
        chunks = []
        
        start = 0
        while start < len(tokens):
            end = min(start + self.chunk_size, len(tokens))
            chunk_tokens = tokens[start:end]
            chunk_text = self.tokenizer.decode(chunk_tokens)
            
            # Include session_id in hash to ensure uniqueness across sessions
            # This allows same file content to exist in different investigations
            chunk_id = hashlib.sha256(
                f"{session_id}:{source_file}:{start}:{chunk_text}".encode()
            ).hexdigest()[:32]
            
            chunks.append({
                "chunk_id": chunk_id,
                "content": chunk_text,
                "token_count": len(chunk_tokens),
                "start_offset": start,
                "end_offset": end
            })
            
            # Move start with overlap
            start = end - self.chunk_overlap if end < len(tokens) else end
        
        return chunks
    
    def _classify_source_type(self, file_path: str) -> str:
        """Classify file into source type for pre-filtering."""
        path_lower = file_path.lower()
        
        for source_type, patterns in self.SOURCE_TYPE_PATTERNS.items():
            for pattern in patterns:
                if pattern in path_lower:
                    return source_type
        
        return "other"
    
    def _classify_artifact_category(self, file_path: str, content: str) -> str:
        """
        Classify artifact into forensic category.
        More nuanced than source_type - uses content analysis.
        """
        path_lower = file_path.lower()
        content_lower = content[:1000].lower()  # Sample first 1000 chars
        
        # User-related
        if any(x in path_lower for x in ['passwd', 'shadow', 'group', 'home/', 'users/']):
            return 'users'
        if any(x in content_lower for x in ['uid=', 'gid=', 'username', 'user:']):
            return 'users'
        
        # Authentication
        if any(x in path_lower for x in ['auth', 'login', 'ssh', 'pam']):
            return 'authentication'
        
        # Network
        if any(x in path_lower for x in ['network', 'hosts', 'resolv', 'interface', 'iptables']):
            return 'network'
        if any(x in content_lower for x in ['ip_address', 'port', 'listen', 'connect']):
            return 'network'
        
        # Persistence
        if any(x in path_lower for x in ['cron', 'systemd', 'init.d', 'rc.local', 'startup']):
            return 'persistence'
        
        # Logs
        if any(x in path_lower for x in ['.log', 'syslog', 'journal', 'audit']):
            return 'logs'
        
        # Processes
        if any(x in path_lower for x in ['proc/', 'ps', 'process']):
            return 'processes'
        
        # Configuration
        if any(x in path_lower for x in ['.conf', '.cfg', 'config', 'settings']):
            return 'configuration'
        
        return 'other'
    
    def _calculate_importance(self, file_path: str, content: str) -> float:
        """
        Calculate heuristic importance score for a chunk.
        Used for cache promotion and retrieval ranking.
        """
        score = 0.0
        path_lower = file_path.lower()
        content_lower = content.lower()
        
        # High-value forensic artifacts
        high_value = ['passwd', 'shadow', 'auth.log', 'bash_history', 
                      'crontab', 'authorized_keys', 'sudoers']
        for artifact in high_value:
            if artifact in path_lower:
                score += 0.3
                break
        
        # Suspicious patterns in content
        suspicious = ['sudo', 'root', 'chmod 777', 'wget', 'curl', 'nc ',
                      'reverse', 'shell', '/tmp/', 'base64', 'eval(']
        for pattern in suspicious:
            if pattern in content_lower:
                score += 0.1
        
        # Cap at 1.0
        return min(score, 1.0)
    
    def _is_text_file(self, file_path: Path) -> bool:
        """Check if file should be indexed as text."""
        # Check extension
        suffix = file_path.suffix.lower()
        
        # Quick check: known text extensions
        if suffix in self.TEXT_EXTENSIONS:
            return True
        
        # Quick check: known binary extensions (skip without reading file)
        if suffix in self.BINARY_EXTENSIONS:
            return False
        
        # Check if extensionless
        if not suffix:
            return True
        
        # For unknown extensions, try to read and detect binary
        try:
            with open(file_path, 'rb') as f:
                chunk = f.read(8192)
                # Check for null bytes (binary indicator)
                if b'\x00' in chunk:
                    return False
                # Try to decode as UTF-8
                try:
                    chunk.decode('utf-8')
                    return True
                except UnicodeDecodeError:
                    return False
        except Exception:
            return False
    
    def ingest_session(self, session: Session, extract_dir: Path, 
                        progress_callback=None) -> dict:
        """
        Ingest all artifacts from a session into tiered storage.
        
        Following RAG_DESIGN.md ingestion pipeline:
        1. Convert raw documents → clean text
        2. Chunk into ~512-token blocks
        3. Generate embeddings once
        4. Store: text in Tier 1, embeddings in Tier 2
        
        Args:
            session: Database session object
            extract_dir: Directory containing extracted artifacts
            progress_callback: Optional callback(step, progress, detail) for progress updates
            
        Returns:
            Ingestion statistics
        """
        def report(step: str, progress: int, detail: str = ""):
            if progress_callback:
                progress_callback(step, progress, detail)
        
        stats = {
            "files_processed": 0,
            "files_skipped": 0,
            "chunks_created": 0,
            "total_tokens": 0,
            "by_category": {},
            "by_source_type": {}
        }
        
        # Get or create ChromaDB collection for this session
        collection_name = f"session_{session.session_id.replace('-', '_')}"
        collection = self.chroma.get_or_create_collection(
            name=collection_name,
            metadata={"session_id": session.session_id}
        )
        
        # First pass: count files for progress
        report("scan", 35, "Scanning files...")
        all_files = list(extract_dir.rglob("*"))
        total_files = len([f for f in all_files if f.is_file()])
        files_done = 0
        
        # Deferred entity list — entities reference chunks via FK, so chunks
        # must be flushed to the DB before entities are added to the session.
        pending_entities: list[Entity] = []
        
        # Walk all files in extract directory
        for file_path in all_files:
            if not file_path.is_file():
                continue
            
            files_done += 1
            # Report progress every 50 files (35-75% range for chunking phase)
            if files_done % 50 == 0:
                pct = 35 + int((files_done / max(total_files, 1)) * 40)
                report("chunk", min(pct, 75), f"Processing file {files_done}/{total_files}...")
            
            # Yield to the gevent event loop every 20 files so SSE keepalives
            # and other requests are not starved by CPU-bound processing.
            if files_done % 20 == 0:
                gevent.sleep(0)
            
            # Skip very large files (>5MB) - check size FIRST (cheap metadata operation)
            try:
                file_stat = file_path.stat()
                file_size = file_stat.st_size
            except Exception:
                stats["files_skipped"] += 1
                continue
                
            if file_size > 5 * 1024 * 1024:
                stats["files_skipped"] += 1
                continue
            
            # Skip if not a text file (may need to read file for unknown extensions)
            if not self._is_text_file(file_path):
                stats["files_skipped"] += 1
                continue
            
            try:
                # Read file content
                with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read()

                # Strip null bytes — PostgreSQL TEXT columns reject \x00
                content = _strip_nul(content)

                if not content.strip():
                    stats["files_skipped"] += 1
                    continue
                
                # Get relative path for metadata (also strip NUL)
                rel_path = _strip_nul(str(file_path.relative_to(extract_dir)))
                
                # Classify for pre-filtering
                source_type = self._classify_source_type(rel_path)
                artifact_category = self._classify_artifact_category(rel_path, content)
                
                # Get file modification time (reuse stat result from earlier)
                try:
                    file_modified = datetime.fromtimestamp(file_stat.st_mtime)
                except Exception:
                    file_modified = None
                
                # Chunk the content (include session_id for unique chunk_ids across sessions)
                chunks = self._chunk_text(content, rel_path, session.session_id)
                
                # Get entity extractor for this batch
                entity_extractor = get_entity_extractor()
                
                for chunk_data in chunks:
                    chunk_id = chunk_data["chunk_id"]
                    chunk_content = _strip_nul(chunk_data["content"])
                    
                    # NOTE: Skip the per-chunk database check - it's a major performance killer
                    # chunk_ids are unique per session by design (they include session_id in hash)
                    # For a NEW session, there can't be existing chunks with this session_id
                    
                    # Calculate importance
                    importance = self._calculate_importance(rel_path, chunk_content)
                    
                    # Collect chunk for bulk insert
                    chunk = Chunk(
                        chunk_id=chunk_id,
                        session_id=session.id,
                        content=chunk_content,
                        content_hash=hashlib.sha256(chunk_content.encode()).hexdigest(),
                        token_count=chunk_data["token_count"],
                        source_file=rel_path,
                        source_type=source_type,
                        artifact_category=artifact_category,
                        file_modified=file_modified,
                        importance_score=importance
                    )
                    db.session.add(chunk)
                    
                    # Extract entities from chunk (fast regex, no LLM)
                    # Defer adding to session — chunks must be flushed first.
                    extracted = entity_extractor.extract_entities(chunk_content, chunk_id)
                    for ent in extracted:
                        pending_entities.append(Entity(
                            session_id=session.id,
                            chunk_id=chunk_id,
                            entity_type=ent.entity_type,
                            entity_value=_strip_nul(ent.value),
                            normalized_value=_strip_nul(ent.normalized_value),
                            context_snippet=_strip_nul(ent.context_snippet),
                            occurrence_count=1
                        ))
                        stats["entities_extracted"] = stats.get("entities_extracted", 0) + 1
                    
                    stats["chunks_created"] += 1
                    stats["total_tokens"] += chunk_data["token_count"]
                    
                    # Track by category/type
                    stats["by_category"][artifact_category] = stats["by_category"].get(artifact_category, 0) + 1
                    stats["by_source_type"][source_type] = stats["by_source_type"].get(source_type, 0) + 1
                
                stats["files_processed"] += 1
                
                # Batch flush chunks, then their entities, every 500 chunks.
                # Chunks must hit the DB before entities to satisfy the FK.
                if stats["chunks_created"] % 500 == 0:
                    db.session.flush()          # flush pending Chunk rows
                    db.session.bulk_save_objects(pending_entities)
                    pending_entities.clear()
                    db.session.flush()           # flush Entity rows
                
            except Exception as e:
                # Rollback so the session isn't poisoned for subsequent files
                db.session.rollback()
                pending_entities.clear()
                logger.warning(f"Skipping file {file_path}: {e}")
                stats["files_skipped"] += 1
                continue
        
        # Flush remaining chunks, then remaining entities, before commit
        db.session.flush()
        if pending_entities:
            db.session.bulk_save_objects(pending_entities)
            pending_entities.clear()
        
        # Commit Tier 1 chunks - session is now searchable!
        report("commit", 75, "Saving chunks to database...")
        session.status = "searchable"  # Timeline and search now work
        db.session.commit()
        
        report("searchable", 76, "Timeline and search ready!")
        
        # Check if auto-embedding is enabled
        from app.routes.config import _get_processing_settings
        auto_embed = _get_processing_settings().get("auto_embed", False)
        
        if not auto_embed:
            # Skip GPU embeddings — session stays "searchable" and queries use BM25
            logger.info(f"⏭️ Auto-embed disabled — session {session.session_id} stays searchable (BM25 only)")
            session.status = "ready"
            db.session.commit()
            report("finalize", 95, "Session ready for queries!")
            report("complete", 100, "Complete!")
            session.total_chunks = stats["chunks_created"]
            db.session.commit()
            return stats
        
        report("searchable_embed", 77, "Starting AI embeddings in background...")
        
        # Run embeddings + graph building on a REAL native OS thread.
        # gevent's monkey.patch_all() turns threading.Thread into greenlets
        # which share the event loop. CPU-bound work like
        # SentenceTransformer.encode() and ChromaDB upserts would block the
        # entire server.  gevent.threadpool gives us actual OS threads.
        from gevent.threadpool import ThreadPoolExecutor as _NativePool
        from flask import current_app
        app = current_app._get_current_object()
        session_id_for_bg = session.session_id
        session_db_id = session.id
        rag_service_ref = self
        
        def _background_embed_and_graph():
            """Generate embeddings and build graph in background."""
            try:
                with app.app_context():
                    bg_session = Session.query.get(session_db_id)
                    if not bg_session:
                        return
                    
                    # Load chunks for embedding
                    new_chunks = Chunk.query.filter_by(session_id=session_db_id).all()
                    
                    if new_chunks:
                        embedding_service = get_embedding_service()
                        use_fast_embeddings = embedding_service.is_available
                        total_chunks = len(new_chunks)
                        
                        if use_fast_embeddings:
                            logger.info(f"🚀 [BG] Generating {total_chunks} embeddings with GPU...")
                            all_documents = [c.content for c in new_chunks]
                            all_embeddings = embedding_service.embed_documents(
                                all_documents, batch_size=128, show_progress=False
                            )
                            
                            UPSERT_BATCH = 500
                            for i in range(0, total_chunks, UPSERT_BATCH):
                                end_idx = min(i + UPSERT_BATCH, total_chunks)
                                batch_chunks = new_chunks[i:end_idx]
                                batch_embeddings = all_embeddings[i:end_idx]
                                batch_docs = all_documents[i:end_idx]
                                try:
                                    coll_name = f"session_{session_id_for_bg.replace('-', '_')}"
                                    collection = rag_service_ref.chroma.get_or_create_collection(
                                        name=coll_name, metadata={"session_id": session_id_for_bg}
                                    )
                                    collection.upsert(
                                        ids=[c.chunk_id for c in batch_chunks],
                                        embeddings=batch_embeddings,
                                        documents=batch_docs,
                                        metadatas=[{
                                            "source_file": c.source_file,
                                            "source_type": c.source_type,
                                            "artifact_category": c.artifact_category,
                                            "importance_score": c.importance_score
                                        } for c in batch_chunks]
                                    )
                                except Exception:
                                    import traceback
                                    traceback.print_exc()
                        else:
                            logger.warning("⚠️ [BG] Using ChromaDB default embeddings (slower)")
                            BATCH_SIZE = 250
                            for i in range(0, total_chunks, BATCH_SIZE):
                                batch = new_chunks[i:i + BATCH_SIZE]
                                try:
                                    coll_name = f"session_{session_id_for_bg.replace('-', '_')}"
                                    collection = rag_service_ref.chroma.get_or_create_collection(
                                        name=coll_name, metadata={"session_id": session_id_for_bg}
                                    )
                                    collection.upsert(
                                        ids=[c.chunk_id for c in batch],
                                        documents=[c.content for c in batch],
                                        metadatas=[{
                                            "source_file": c.source_file,
                                            "source_type": c.source_type,
                                            "artifact_category": c.artifact_category,
                                            "importance_score": c.importance_score
                                        } for c in batch]
                                    )
                                except Exception:
                                    import traceback
                                    traceback.print_exc()
                    
                    # Build entity relationship graph
                    try:
                        from app.services.graph_rag_service import get_graph_rag_service
                        graph_service = get_graph_rag_service()
                        graph_service.build_relationships_for_session(session_id_for_bg)
                    except Exception:
                        import traceback
                        traceback.print_exc()
                    
                    # Mark session as fully ready
                    bg_session.status = "ready"
                    bg_session.has_embeddings = True
                    db.session.commit()
                    logger.info(f"✅ [BG] Session {session_id_for_bg} embeddings + graph complete")
                    
            except Exception:
                import traceback
                traceback.print_exc()
                try:
                    with app.app_context():
                        bg_session = Session.query.get(session_db_id)
                        if bg_session and bg_session.status != "ready":
                            # Keep as searchable, don't mark failed - data is still usable
                            logger.error(f"❌ [BG] Embedding failed for {session_id_for_bg}, keeping searchable")
                except Exception:
                    pass
        
        _bg_pool = _NativePool(max_workers=1)
        _bg_pool.submit(_background_embed_and_graph)
        # Pool is intentionally not shut down here — the daemon thread
        # will finish on its own and the pool will be GC'd.
        
        # Return stats immediately - session is searchable
        report("embed", 80, "Embeddings running in background...")
        report("finalize", 95, "Session ready for queries!")
        report("complete", 100, "Complete!")
        
        # Update session stats before returning
        session.total_chunks = stats["chunks_created"]
        db.session.commit()
        
        return stats
    
    def _get_context_window(self, chunk_id: str, session_id: int, window_size: int = 1) -> list[dict]:
        """
        Get surrounding chunks from the same source file for better context.
        
        Args:
            chunk_id: The center chunk's ID
            session_id: Database session ID (not UUID)
            window_size: Number of chunks before/after to include
            
        Returns:
            List of chunk dicts (before + center + after) in order
        """
        # Get the center chunk
        center_chunk = Chunk.query.filter_by(chunk_id=chunk_id).first()
        if not center_chunk:
            return []
        
        source_file = center_chunk.source_file
        
        # Get all chunks from same file, ordered by their position (using chunk_index or id)
        # Most chunks have a natural order based on insertion order
        file_chunks = Chunk.query.filter_by(
            session_id=session_id,
            source_file=source_file
        ).order_by(Chunk.id).all()
        
        if not file_chunks:
            return [{"chunk_id": chunk_id, "content": center_chunk.content}]
        
        # Find the center chunk's position
        center_idx = None
        for i, ch in enumerate(file_chunks):
            if ch.chunk_id == chunk_id:
                center_idx = i
                break
        
        if center_idx is None:
            return [{"chunk_id": chunk_id, "content": center_chunk.content}]
        
        # Get window
        start_idx = max(0, center_idx - window_size)
        end_idx = min(len(file_chunks), center_idx + window_size + 1)
        
        window_chunks = []
        for ch in file_chunks[start_idx:end_idx]:
            window_chunks.append({
                "chunk_id": ch.chunk_id,
                "content": ch.content,
                "source_file": ch.source_file,
                "is_center": ch.chunk_id == chunk_id
            })
        
        return window_chunks
    
    def search_by_entity(self, session_id: str, entity_value: str, 
                         entity_type: str | None = None) -> list[dict]:
        """
        Find chunks containing a specific entity (IP, username, filepath, etc).
        
        Fast lookup using the Entity table indices.
        
        Args:
            session_id: Session UUID
            entity_value: The entity value to search for
            entity_type: Optional filter by type (ip, domain, username, etc)
            
        Returns:
            List of chunk info dicts with entity context
        """
        # Get session
        session = Session.query.filter_by(session_id=session_id).first()
        if not session:
            return []
        
        # Normalize search value for case-insensitive matching
        normalized = entity_value.lower().strip()
        
        # Build query
        query = Entity.query.filter(
            Entity.session_id == session.id,
            Entity.normalized_value.ilike(f'%{normalized}%')
        )
        if entity_type:
            query = query.filter(Entity.entity_type == entity_type)
        
        # Execute with limit
        entities = query.limit(100).all()
        
        # Get unique chunks
        chunk_ids = set(e.chunk_id for e in entities)
        
        results = []
        for ent in entities:
            if ent.chunk_id not in chunk_ids:
                continue
            chunk_ids.discard(ent.chunk_id)  # Only process each chunk once
            
            chunk = Chunk.query.filter_by(chunk_id=ent.chunk_id).first()
            if chunk:
                results.append({
                    "chunk_id": chunk.chunk_id,
                    "source_file": chunk.source_file,
                    "content": chunk.content,
                    "entity_type": ent.entity_type,
                    "entity_value": ent.entity_value,
                    "context_snippet": ent.context_snippet,
                    "artifact_category": chunk.artifact_category
                })
        
        return results
    
    def get_session_entities(self, session_id: str, entity_type: str | None = None,
                             limit: int = 100) -> list[dict]:
        """
        Get summary of entities in a session.
        
        Useful for showing users what entities were found.
        
        Args:
            session_id: Session UUID
            entity_type: Optional filter by type
            limit: Max entities to return
            
        Returns:
            List of entity summaries with occurrence counts
        """
        session = Session.query.filter_by(session_id=session_id).first()
        if not session:
            return []
        
        # Use SQL aggregation for efficiency
        from sqlalchemy import func
        
        query = db.session.query(
            Entity.entity_type,
            Entity.normalized_value,
            Entity.entity_value,
            func.count(Entity.id).label('occurrences')
        ).filter(
            Entity.session_id == session.id
        ).group_by(
            Entity.entity_type,
            Entity.normalized_value,
            Entity.entity_value
        ).order_by(
            func.count(Entity.id).desc()
        )
        
        if entity_type:
            query = query.filter(Entity.entity_type == entity_type)
        
        results = query.limit(limit).all()
        
        return [
            {
                "type": r.entity_type,
                "value": r.entity_value,
                "normalized": r.normalized_value,
                "occurrences": r.occurrences
            }
            for r in results
        ]
    
    def _extract_entities_from_query(self, query_text: str) -> list[str]:
        """
        Extract potential entity values from user query for boosting.
        
        Uses same extractor as ingestion for consistency.
        """
        extractor = get_entity_extractor()
        entities = extractor.extract_entities(query_text)
        return [e.normalized_value for e in entities]
    
    def query(self, session_id: str, query_text: str, 
              artifact_categories: list[str] | None = None,
              source_types: list[str] | None = None,
              top_k: int = 10,
              use_hybrid: bool = True,
              use_reranking: bool = True,
              include_context_window: bool = False) -> dict:
        """
        Query the RAG system with hybrid search (BM25 + Vector) and cross-encoder reranking.
        
        Enhanced flow:
        1. Hot Cache Lookup (<5ms target)
        2. Query Expansion with forensic domain knowledge
        3. Hybrid Search: BM25 (exact matches) + Vector (semantic)
        4. Optional pre-filtering (only if explicitly requested)
        5. Cross-Encoder Reranking for precision
        6. Context Assembly with optional context windows
        
        Args:
            session_id: Session UUID
            query_text: User query
            artifact_categories: Optional filter by categories (no longer mandatory)
            source_types: Optional filter by source types
            top_k: Number of final chunks to return
            use_hybrid: Whether to use BM25+Vector hybrid search
            use_reranking: Whether to use cross-encoder reranking
            include_context_window: Include surrounding chunks from same file
            
        Returns:
            Retrieved context and metadata
        """
        import time
        start_time = time.time()
        
        # Get session
        session = Session.query.filter_by(session_id=session_id).first()
        if not session:
            return {"error": "Session not found", "chunks": [], "context": ""}
        
        # Build cache key
        cache_key = hashlib.sha256(
            f"{session_id}:{query_text}:{artifact_categories}:{source_types}".encode()
        ).hexdigest()
        
        # Step 1: Hot Cache Lookup
        cached = self.hot_cache.get(cache_key)
        if cached:
            return {
                "chunks": [],
                "context": cached,
                "cache_hit": True,
                "retrieval_time_ms": int((time.time() - start_time) * 1000)
            }
        
        # Step 2: Query Expansion
        expanded_query = self._expand_query(query_text)
        
        # Step 2b: Entity Extraction from query (for entity-aware boosting)
        query_entities = self._extract_entities_from_query(query_text)
        entity_chunk_ids = set()
        if query_entities:
            # Find chunks containing these entities
            for entity_val in query_entities[:5]:  # Limit to 5 entities
                for ent in Entity.query.filter(
                    Entity.session_id == session.id,
                    Entity.normalized_value.ilike(f'%{entity_val}%')
                ).limit(20).all():
                    entity_chunk_ids.add(ent.chunk_id)
        
        # Get all chunk IDs for this session (for filtering search results)
        all_session_chunks = set(c.chunk_id for c in Chunk.query.filter_by(session_id=session.id).all())
        
        if not all_session_chunks:
            return {
                "chunks": [],
                "context": "",
                "cache_hit": False,
                "retrieval_time_ms": int((time.time() - start_time) * 1000),
                "message": "No chunks in session"
            }
        
        # Step 3: Hybrid Search (retrieve more candidates for reranking)
        # Retrieve 5x top_k candidates for cross-encoder to rerank
        retrieval_k = top_k * 5
        chunk_scores: dict[str, dict] = {}
        
        # 3a: BM25 Search (exact/keyword matches)
        if use_hybrid and HAS_BM25:
            bm25_index = self._get_bm25_index(session_id)
            bm25_results = bm25_index.search(expanded_query, top_k=retrieval_k)
            
            for chunk_id, bm25_score in bm25_results:
                if chunk_id in all_session_chunks:
                    chunk_scores[chunk_id] = {
                        "bm25_score": bm25_score,
                        "vector_score": 0.0,
                        "combined_score": 0.0
                    }
        
        # 3b: Vector Search (semantic matches)
        collection_name = f"session_{session_id.replace('-', '_')}"
        try:
            collection = self.chroma.get_collection(name=collection_name)
            
            # Get embedding service for query embedding
            embedding_service = get_embedding_service()
            
            if embedding_service.is_available:
                # Use fast GPU-accelerated embedding for query
                query_embedding = embedding_service.embed_query(expanded_query)
                results = collection.query(
                    query_embeddings=[query_embedding],
                    n_results=min(retrieval_k, len(all_session_chunks), 100),
                    include=["documents", "metadatas", "distances"]
                )
            else:
                # Fallback: let ChromaDB embed the query
                results = collection.query(
                    query_texts=[expanded_query],
                    n_results=min(retrieval_k, len(all_session_chunks), 100),
                    include=["documents", "metadatas", "distances"]
                )
            
            if results["ids"] and results["ids"][0]:
                max_distance = max(results["distances"][0]) if results["distances"][0] else 1.0
                
                for i, chunk_id in enumerate(results["ids"][0]):
                    if chunk_id in all_session_chunks:
                        # Convert distance to similarity score (0-1)
                        distance = results["distances"][0][i]
                        vector_score = 1 - (distance / (max_distance + 0.001))
                        
                        if chunk_id not in chunk_scores:
                            chunk_scores[chunk_id] = {
                                "bm25_score": 0.0,
                                "vector_score": vector_score,
                                "combined_score": 0.0,
                                "content": results["documents"][0][i],
                                "metadata": results["metadatas"][0][i],
                                "distance": distance
                            }
                        else:
                            chunk_scores[chunk_id]["vector_score"] = vector_score
                            chunk_scores[chunk_id]["content"] = results["documents"][0][i]
                            chunk_scores[chunk_id]["metadata"] = results["metadatas"][0][i]
                            chunk_scores[chunk_id]["distance"] = distance
                            
        except Exception as e:
            # Fall back to BM25 only if vector search fails
            if not chunk_scores:
                return {
                    "error": f"Search failed: {str(e)}",
                    "chunks": [],
                    "context": "",
                    "retrieval_time_ms": int((time.time() - start_time) * 1000)
                }
        
        # Step 4: Optional Pre-filtering (apply AFTER hybrid search, not before)
        # This allows hybrid search to find all candidates, then filter
        if artifact_categories or source_types:
            filtered_ids = set()
            filter_query = Chunk.query.filter_by(session_id=session.id)
            if artifact_categories:
                filter_query = filter_query.filter(Chunk.artifact_category.in_(artifact_categories))
            if source_types:
                filter_query = filter_query.filter(Chunk.source_type.in_(source_types))
            filtered_ids = set(c.chunk_id for c in filter_query.all())
            
            # Only keep chunks that match filters
            chunk_scores = {cid: s for cid, s in chunk_scores.items() if cid in filtered_ids}
        
        # Determine if query is keyword-focused (should weight BM25 higher)
        # Keywords: short queries, single words, commands, IPs, file paths
        query_words = query_text.lower().split()
        is_keyword_query = (
            len(query_words) <= 3 or
            any(word in ['wget', 'curl', 'ssh', 'sudo', 'bash', 'python', 'perl', 'nc', 'cat', 'grep', 
                         'chmod', 'chown', 'rm', 'cp', 'mv', 'ls', 'cd', 'find', 'awk', 'sed',
                         'cron', 'systemctl', 'service'] for word in query_words) or
            any('/' in word or '.' in word and len(word.split('.')) >= 3 for word in query_words) or  # paths or IPs
            bool(re.search(r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}', query_text))  # IP address
        )
        
        # Score Fusion - adaptive weighting based on query type
        for chunk_id, scores in chunk_scores.items():
            # Better BM25 normalization - don't over-penalize
            bm25_norm = min(scores["bm25_score"] / 5.0, 1.0) if scores["bm25_score"] > 0 else 0.0
            
            # Adaptive weighting: keyword queries favor BM25, semantic queries favor vector
            if is_keyword_query:
                vector_weight = 0.3
                bm25_weight = 0.7  # Heavy BM25 for keyword searches
            else:
                vector_weight = 0.6
                bm25_weight = 0.4
                
            combined = (vector_weight * scores["vector_score"]) + (bm25_weight * bm25_norm)
            
            # Boost chunks appearing in both searches
            if scores["bm25_score"] > 0 and scores["vector_score"] > 0:
                combined *= 1.2
            
            # Boost chunks containing entities from the query (Phase 3)
            if chunk_id in entity_chunk_ids:
                combined *= 1.3  # 30% boost for entity matches
                scores["entity_match"] = True
            
            scores["combined_score"] = combined
        
        # Fetch content for chunks from BM25 if missing
        for chunk_id, scores in chunk_scores.items():
            if "content" not in scores:
                db_chunk = Chunk.query.filter_by(chunk_id=chunk_id).first()
                if db_chunk:
                    scores["content"] = db_chunk.content
                    scores["metadata"] = {
                        "source_file": db_chunk.source_file,
                        "source_type": db_chunk.source_type,
                        "artifact_category": db_chunk.artifact_category,
                        "importance_score": db_chunk.importance_score
                    }
        
        # Prepare chunks for reranking
        candidates = [
            {
                "chunk_id": cid,
                "content": s.get("content", ""),
                "metadata": s.get("metadata", {}),
                "combined_score": s["combined_score"],
                "bm25_score": s.get("bm25_score", 0),
                "vector_score": s.get("vector_score", 0),
            }
            for cid, s in chunk_scores.items()
            if "content" in s
        ]
        
        # Step 5: Cross-Encoder Reranking
        if use_reranking and len(candidates) > 0:
            reranked = self._rerank_with_cross_encoder(query_text, candidates, top_k=top_k)
        else:
            # Fallback to combined score ranking
            reranked = sorted(candidates, key=lambda x: x["combined_score"], reverse=True)[:top_k]
        
        # Step 6: Context Assembly (with optional context windows)
        seen_content = set()
        context_parts = []
        chunk_details = []
        
        for chunk in reranked:
            content = chunk.get("content", "")
            if not content:
                continue
            
            source = chunk.get("metadata", {}).get("source_file", "unknown")
            
            # Optional: Get context window (surrounding chunks from same file)
            if include_context_window:
                window = self._get_context_window(chunk["chunk_id"], session.id, window_size=1)
                
                # Combine window chunks into expanded content
                if len(window) > 1:
                    window_parts = []
                    for wchunk in window:
                        wcontent = wchunk.get("content", "")
                        if wchunk.get("is_center"):
                            # Mark the matched chunk
                            window_parts.append(f">>> {wcontent}")
                        else:
                            window_parts.append(wcontent)
                    content = "\n...\n".join(window_parts)
            
            content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]
            if content_hash in seen_content:
                continue
            seen_content.add(content_hash)
            
            context_parts.append(f"[Source: {source}]\n{content}")
            
            chunk_details.append({
                "chunk_id": chunk["chunk_id"],
                "source_file": source,
                "text": content,
                "category": chunk.get("metadata", {}).get("artifact_category"),
                "relevance_score": chunk.get("cross_encoder_score", chunk.get("combined_score", 0)),
                "bm25_score": chunk.get("bm25_score", 0),
                "vector_score": chunk.get("vector_score", 0),
                "cross_encoder_score": chunk.get("cross_encoder_score")
            })
            
            # Update access count
            db_chunk = Chunk.query.filter_by(chunk_id=chunk["chunk_id"]).first()
            if db_chunk:
                db_chunk.access_count += 1
                db_chunk.last_accessed = datetime.utcnow()
        
        db.session.commit()
        
        # Assemble context
        context = "\n\n---\n\n".join(context_parts)
        
        # Cache result
        self.hot_cache.put(cache_key, context)
        
        retrieval_time = int((time.time() - start_time) * 1000)
        
        return {
            "chunks": chunk_details,
            "context": context,
            "cache_hit": False,
            "retrieval_time_ms": retrieval_time,
            "total_chunks_searched": len(all_session_chunks),
            "candidates_before_rerank": len(candidates),
            "chunks_retrieved": len(chunk_details),
            "query_expanded": expanded_query,
            "hybrid_search": use_hybrid and HAS_BM25,
            "cross_encoder_reranking": use_reranking and HAS_CROSS_ENCODER
        }
    
    def get_cache_stats(self) -> dict:
        """Get hot cache statistics."""
        return self.hot_cache.get_stats()
    
    def clear_session(self, session_id: str) -> None:
        """Clear all data for a session from all tiers."""
        # Clear from ChromaDB (Tier 2)
        collection_name = f"session_{session_id.replace('-', '_')}"
        try:
            self.chroma.delete_collection(name=collection_name)
        except Exception:
            pass
        
        # Tier 1 cleanup happens via cascade delete in SQLAlchemy
    
    def get_session_stats(self, session_id: str) -> dict:
        """
        Get comprehensive statistics about a session's indexed data.
        
        Useful for showing users what the AI can see/query.
        """
        session = Session.query.filter_by(session_id=session_id).first()
        if not session:
            return {
                "error": "Session not found",
                "session_id": session_id,
            }
        
        # Get chunk stats from Tier 1 (SQLite)
        chunks = Chunk.query.filter_by(session_id=session.id).all()
        
        # Aggregate stats
        categories = {}
        source_types = {}
        total_tokens = 0
        files = set()
        
        for chunk in chunks:
            # Category counts
            cat = chunk.artifact_category or "unknown"
            categories[cat] = categories.get(cat, 0) + 1
            
            # Source type counts
            src = chunk.source_type or "unknown"
            source_types[src] = source_types.get(src, 0) + 1
            
            # Tokens
            total_tokens += chunk.token_count
            
            # Unique files
            files.add(chunk.source_file)
        
        # Get most accessed chunks
        top_chunks = Chunk.query.filter_by(session_id=session.id)\
            .order_by(Chunk.access_count.desc())\
            .limit(5).all()
        
        top_accessed = [
            {
                "source_file": c.source_file,
                "category": c.artifact_category,
                "access_count": c.access_count,
            }
            for c in top_chunks
        ]
        
        return {
            "session_id": session_id,
            "status": session.status,
            "hostname": session.hostname,
            "os_type": session.os_type,
            "original_filename": session.original_filename,
            "parsed_at": session.parsed_at.isoformat() if session.parsed_at else None,
            "total_chunks": len(chunks),
            "total_tokens": total_tokens,
            "total_files": len(files),
            "categories": categories,
            "source_types": source_types,
            "top_accessed_sources": top_accessed,
            "cache_stats": self.hot_cache.get_stats(),
        }
