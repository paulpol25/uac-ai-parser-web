"""
RAG Service - ChromaDB-based Retrieval Augmented Generation for forensic data.

This service indexes parsed artifacts into ChromaDB and retrieves relevant
context for LLM queries.
"""
import logging
from pathlib import Path
from typing import Any
import chromadb
from chromadb.config import Settings
import hashlib
import os

logger = logging.getLogger(__name__)


class RAGService:
    """Service for RAG-based context retrieval using ChromaDB."""
    
    # Singleton client
    _client = None
    _collections: dict[str, Any] = {}
    
    # File extensions to index (text-based forensic artifacts)
    INDEXABLE_EXTENSIONS = {
        '.txt', '.log', '.conf', '.cfg', '.ini', '.json', '.xml',
        '.csv', '.sh', '.bash', '.py', '.pl', '.rb',
        '.html', '.htm', '.md', '.yaml', '.yml',
        '', '.bashrc', '.bash_history', '.zsh_history',
    }
    
    # Files to always try indexing (by name pattern)
    FORENSIC_FILES = {
        'passwd', 'shadow', 'group', 'sudoers', 'hosts', 'resolv.conf',
        'crontab', 'fstab', 'mtab', 'modules', 'services',
        'authorized_keys', 'known_hosts', 'ssh_config', 'sshd_config',
        'history', 'bash_history', 'zsh_history',
        'lastlog', 'wtmp', 'btmp', 'utmp',
        'auth.log', 'syslog', 'messages', 'secure', 'audit.log',
        'access.log', 'error.log',
    }
    
    # Max file size to index (5MB)
    MAX_FILE_SIZE = 5 * 1024 * 1024
    
    # Chunk size for splitting large files
    CHUNK_SIZE = 2000
    CHUNK_OVERLAP = 200
    
    def __init__(self, persist_dir: Path | None = None):
        """Initialize ChromaDB client."""
        if RAGService._client is None:
            if persist_dir:
                persist_dir.mkdir(parents=True, exist_ok=True)
                RAGService._client = chromadb.PersistentClient(
                    path=str(persist_dir),
                    settings=Settings(anonymized_telemetry=False)
                )
            else:
                RAGService._client = chromadb.Client(
                    settings=Settings(anonymized_telemetry=False)
                )
        self.client = RAGService._client
    
    def index_session(self, session_id: str, extract_dir: Path) -> dict[str, Any]:
        """
        Index all artifacts from a session into ChromaDB.
        
        Args:
            session_id: Unique session identifier
            extract_dir: Directory containing extracted artifacts
            
        Returns:
            Indexing statistics
        """
        collection_name = f"session_{session_id.replace('-', '_')}"
        
        # Get or create collection for this session
        collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"session_id": session_id}
        )
        RAGService._collections[session_id] = collection
        
        stats = {
            "files_processed": 0,
            "chunks_indexed": 0,
            "files_skipped": 0,
            "errors": []
        }
        
        # Walk through extracted directory and index files
        for file_path in extract_dir.rglob("*"):
            if not file_path.is_file():
                continue
            
            # Check if file should be indexed
            if not self._should_index(file_path):
                stats["files_skipped"] += 1
                continue
            
            try:
                # Read and chunk file content
                chunks = self._read_and_chunk(file_path, extract_dir)
                
                if not chunks:
                    stats["files_skipped"] += 1
                    continue
                
                # Add chunks to collection
                for i, chunk in enumerate(chunks):
                    doc_id = self._generate_id(file_path, i)
                    relative_path = str(file_path.relative_to(extract_dir))
                    
                    collection.add(
                        documents=[chunk["content"]],
                        metadatas=[{
                            "file_path": relative_path,
                            "chunk_index": i,
                            "total_chunks": len(chunks),
                            "category": self._categorize_file(relative_path),
                            "file_name": file_path.name
                        }],
                        ids=[doc_id]
                    )
                    stats["chunks_indexed"] += 1
                
                stats["files_processed"] += 1
                
            except Exception as e:
                stats["errors"].append(f"{file_path.name}: {str(e)}")
        
        return stats
    
    def query(
        self,
        session_id: str,
        query_text: str,
        n_results: int = 10
    ) -> list[dict[str, Any]]:
        """
        Query ChromaDB for relevant context.
        
        Args:
            session_id: Session to query
            query_text: User's query
            n_results: Number of results to return
            
        Returns:
            List of relevant document chunks with metadata
        """
        collection = self._get_collection(session_id)
        if collection is None:
            return []
        
        try:
            results = collection.query(
                query_texts=[query_text],
                n_results=n_results,
                include=["documents", "metadatas", "distances"]
            )
            
            # Format results
            formatted = []
            if results["documents"] and results["documents"][0]:
                for i, doc in enumerate(results["documents"][0]):
                    formatted.append({
                        "content": doc,
                        "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                        "relevance": 1 - (results["distances"][0][i] if results["distances"] else 0)
                    })
            
            return formatted
            
        except Exception as e:
            logger.error(f"RAG query error: {e}")
            return []
    
    def get_collection_stats(self, session_id: str) -> dict[str, Any] | None:
        """Get statistics about a session's indexed data."""
        collection = self._get_collection(session_id)
        if collection is None:
            return None
        
        return {
            "total_documents": collection.count(),
            "session_id": session_id
        }
    
    def delete_session(self, session_id: str) -> bool:
        """Delete a session's ChromaDB collection."""
        collection_name = f"session_{session_id.replace('-', '_')}"
        try:
            self.client.delete_collection(collection_name)
            if session_id in RAGService._collections:
                del RAGService._collections[session_id]
            return True
        except Exception:
            return False
    
    def _get_collection(self, session_id: str):
        """Get collection for a session."""
        if session_id in RAGService._collections:
            return RAGService._collections[session_id]
        
        collection_name = f"session_{session_id.replace('-', '_')}"
        try:
            collection = self.client.get_collection(collection_name)
            RAGService._collections[session_id] = collection
            return collection
        except Exception:
            return None
    
    def _should_index(self, file_path: Path) -> bool:
        """Determine if a file should be indexed."""
        # Check file size
        try:
            if file_path.stat().st_size > self.MAX_FILE_SIZE:
                return False
            if file_path.stat().st_size == 0:
                return False
        except OSError:
            return False
        
        # Check if it's a known forensic file
        if file_path.name.lower() in self.FORENSIC_FILES:
            return True
        
        # Check extension
        suffix = file_path.suffix.lower()
        if suffix in self.INDEXABLE_EXTENSIONS:
            return True
        
        # Check if file appears to be text
        return self._is_likely_text(file_path)
    
    def _is_likely_text(self, file_path: Path) -> bool:
        """Check if a file is likely to be text-based."""
        try:
            with open(file_path, 'rb') as f:
                chunk = f.read(1024)
                # Check for null bytes (binary indicator)
                if b'\x00' in chunk:
                    return False
                # Try to decode as UTF-8
                try:
                    chunk.decode('utf-8')
                    return True
                except UnicodeDecodeError:
                    return False
        except (OSError, IOError):
            return False
    
    def _read_and_chunk(self, file_path: Path, extract_dir: Path) -> list[dict]:
        """Read file and split into chunks."""
        try:
            # Try UTF-8 first, fall back to latin-1
            try:
                content = file_path.read_text(encoding='utf-8')
            except UnicodeDecodeError:
                content = file_path.read_text(encoding='latin-1')
            
            if not content.strip():
                return []
            
            # Add file path context to content
            relative_path = str(file_path.relative_to(extract_dir))
            
            # Split into chunks
            chunks = []
            for i in range(0, len(content), self.CHUNK_SIZE - self.CHUNK_OVERLAP):
                chunk_content = content[i:i + self.CHUNK_SIZE]
                if chunk_content.strip():
                    chunks.append({
                        "content": f"[File: {relative_path}]\n{chunk_content}",
                        "start": i,
                        "end": min(i + self.CHUNK_SIZE, len(content))
                    })
            
            return chunks
            
        except Exception as e:
            return []
    
    def _generate_id(self, file_path: Path, chunk_index: int) -> str:
        """Generate a unique ID for a document chunk."""
        content = f"{file_path}:{chunk_index}"
        return hashlib.md5(content.encode()).hexdigest()
    
    def _categorize_file(self, path: str) -> str:
        """Categorize a file based on its path."""
        path_lower = path.lower()
        
        if any(x in path_lower for x in ['passwd', 'shadow', 'group', 'user']):
            return 'users'
        if any(x in path_lower for x in ['log', 'syslog', 'messages', 'auth']):
            return 'logs'
        if any(x in path_lower for x in ['cron', 'systemd', 'init.d', 'rc.']):
            return 'persistence'
        if any(x in path_lower for x in ['ssh', 'authorized_keys', 'known_hosts']):
            return 'ssh'
        if any(x in path_lower for x in ['network', 'hosts', 'resolv', 'interface']):
            return 'network'
        if any(x in path_lower for x in ['process', 'proc/', 'ps']):
            return 'processes'
        if any(x in path_lower for x in ['etc/', 'conf', 'config']):
            return 'configuration'
        if any(x in path_lower for x in ['history', 'bash_history', 'zsh_history']):
            return 'shell_history'
        
        return 'other'
