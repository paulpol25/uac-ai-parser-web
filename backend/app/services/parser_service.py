"""
Parser Service - Handles UAC archive extraction and parsing.

Uses tiered storage architecture per RAG_DESIGN.md:
- Tier 0: Raw archives remain in filesystem (cold storage)
- Tier 1: Parsed chunks stored in SQLite
- Tier 2: Embeddings in ChromaDB
"""
import tarfile
import zipfile
import hashlib
from pathlib import Path
from typing import Any, Callable
from datetime import datetime

from app.models import db, Session, Investigation
from app.services.tiered_rag_service import TieredRAGService

# Progress callback type: (step: str, progress: int, detail: str) -> None
ProgressCallback = Callable[[str, int, str], None]


class ParserService:
    """Service for parsing UAC archive files."""
    
    def __init__(self, chroma_persist_dir: Path = None, chunk_size: int = 512, 
                 chunk_overlap: int = 50, hot_cache_size: int = 1000):
        """Initialize parser with tiered RAG service."""
        # Use default chroma path if not provided
        if chroma_persist_dir is None:
            chroma_persist_dir = Path.home() / '.uac-ai' / 'chroma'
        
        self.rag_service = TieredRAGService(
            chroma_persist_dir=chroma_persist_dir,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            hot_cache_size=hot_cache_size
        )
    
    def parse(self, file_path: Path, session_id: str, investigation_id: int,
              progress_callback: ProgressCallback | None = None) -> dict[str, Any]:
        """
        Parse a UAC archive file and ingest into tiered storage.
        
        Args:
            file_path: Path to the uploaded archive
            session_id: Unique session identifier (UUID)
            investigation_id: ID of the owning investigation
            progress_callback: Optional callback for progress updates (step, percent, detail)
            
        Returns:
            Parsing result with summary and preview
        """
        def report(step: str, progress: int, detail: str = ""):
            if progress_callback:
                progress_callback(step, progress, detail)
        
        report("init", 0, "Initializing...")
        
        # Calculate file hash for deduplication
        report("hash", 5, "Calculating file hash...")
        file_hash = self._calculate_file_hash(file_path)
        file_size = file_path.stat().st_size
        
        # Create database session record
        report("database", 10, "Creating session record...")
        session = Session(
            session_id=session_id,
            investigation_id=investigation_id,
            original_filename=file_path.name,
            file_hash=file_hash,
            file_size=file_size,
            archive_path=str(file_path),
            status="processing"
        )
        db.session.add(session)
        db.session.commit()
        
        try:
            # Determine archive type and extract
            extract_dir = file_path.parent / "extracted"
            extract_dir.mkdir(exist_ok=True)
            
            report("extract", 15, f"Extracting {file_path.name}...")
            
            if str(file_path).endswith(".tar.gz") or str(file_path).endswith(".tgz"):
                self._extract_tar(file_path, extract_dir, progress_callback)
            elif str(file_path).endswith(".zip"):
                self._extract_zip(file_path, extract_dir)
            else:
                raise ValueError(f"Unsupported archive format: {file_path.suffix}")
            
            session.extract_path = str(extract_dir)
            
            report("sysinfo", 25, "Extracting system information...")
            # Extract system info from UAC
            system_info = self._extract_system_info(extract_dir)
            session.hostname = system_info.get("hostname")
            session.os_type = system_info.get("os_type")
            session.collection_date = system_info.get("collection_date")
            
            report("artifacts", 30, "Parsing artifacts...")
            # Parse artifacts for summary
            artifacts = self._parse_artifacts(extract_dir)
            session.total_artifacts = len(artifacts)
            
            report("ingest", 35, f"Indexing {len(artifacts)} files for RAG...")
            # Ingest into tiered RAG storage (expensive operation - done once)
            # Pass progress callback for detailed tracking during ingestion
            rag_stats = self.rag_service.ingest_session(session, extract_dir, progress_callback)
            
            # Update session with final stats
            report("finalize", 95, "Finalizing...")
            session.total_chunks = rag_stats["chunks_created"]
            session.status = "ready"
            db.session.commit()
            
            # Generate summary and preview
            summary = self._generate_summary(artifacts, rag_stats)
            preview = self._generate_preview(artifacts)
            
            report("complete", 100, "Parsing complete!")
            
            return {
                "session_id": session_id,
                "summary": summary,
                "preview": preview,
                "rag_stats": rag_stats,
                "system_info": system_info
            }
            
        except Exception as e:
            # Rollback any pending transaction before updating status
            db.session.rollback()
            
            # Update session with error status
            session.status = "failed"
            session.error_message = str(e)
            db.session.commit()
            raise
    
    def get_status(self, session_id: str) -> dict | None:
        """Get parsing status for a session."""
        session = Session.query.filter_by(session_id=session_id).first()
        if session is None:
            return None
        
        return {
            "status": session.status,
            "total_artifacts": session.total_artifacts,
            "total_chunks": session.total_chunks,
            "hostname": session.hostname,
            "os_type": session.os_type,
            "error_message": session.error_message,
            "parsed_at": session.parsed_at.isoformat() if session.parsed_at else None
        }
    
    def get_artifacts(self, session_id: str) -> list[dict] | None:
        """Get parsed artifacts for a session."""
        session = Session.query.filter_by(session_id=session_id).first()
        if session is None or not session.extract_path:
            return None
        
        extract_dir = Path(session.extract_path)
        if not extract_dir.exists():
            return None
        
        return self._parse_artifacts(extract_dir)
    
    def _calculate_file_hash(self, file_path: Path) -> str:
        """Calculate SHA256 hash of file."""
        sha256 = hashlib.sha256()
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)
        return sha256.hexdigest()
    
    def _extract_tar(self, file_path: Path, extract_dir: Path, 
                     progress_callback: ProgressCallback | None = None) -> None:
        """
        Extract a tar.gz archive safely.
        
        UAC archives contain symlinks from Linux systems that may point
        outside the extraction directory. We skip these safely.
        """
        with tarfile.open(file_path, "r:gz") as tar:
            members = tar.getmembers()
            total = len(members)
            for i, member in enumerate(members):
                # Report progress during extraction (15-25% range)
                if progress_callback and i % 100 == 0:
                    pct = 15 + int((i / max(total, 1)) * 10)
                    progress_callback("extract", pct, f"Extracting file {i}/{total}...")
                
                # Skip symlinks that could point outside (security)
                if member.issym() or member.islnk():
                    continue
                # Skip absolute paths
                if member.name.startswith('/') or member.name.startswith('..'):
                    continue
                # Extract safely
                try:
                    tar.extract(member, extract_dir, set_attrs=False)
                except (tarfile.TarError, OSError, KeyError):
                    # Skip problematic files
                    continue
    
    def _extract_zip(self, file_path: Path, extract_dir: Path) -> None:
        """Extract a zip archive."""
        with zipfile.ZipFile(file_path, "r") as zip_ref:
            zip_ref.extractall(extract_dir)
    
    def _extract_system_info(self, extract_dir: Path) -> dict:
        """Extract system information from UAC artifacts."""
        info = {
            "hostname": None,
            "os_type": None,
            "collection_date": None
        }
        
        # Try to find hostname
        hostname_files = [
            extract_dir / "live_response" / "system" / "hostname.txt",
            extract_dir / "etc" / "hostname",
        ]
        for hf in hostname_files:
            if hf.exists():
                try:
                    info["hostname"] = hf.read_text().strip().split('\n')[0]
                    break
                except Exception:
                    pass
        
        # Try to find OS type
        os_files = [
            (extract_dir / "etc" / "os-release", "linux"),
            (extract_dir / "etc" / "redhat-release", "linux"),
            (extract_dir / "live_response" / "system" / "uname.txt", "linux"),
        ]
        for of, os_type in os_files:
            if of.exists():
                info["os_type"] = os_type
                break
        
        # Collection date from UAC metadata if available
        uac_log = extract_dir / "uac.log"
        if uac_log.exists():
            try:
                stat = uac_log.stat()
                info["collection_date"] = datetime.fromtimestamp(stat.st_mtime)
            except Exception:
                pass
        
        return info
    
    def _parse_artifacts(self, extract_dir: Path) -> list[dict]:
        """
        Parse artifacts from extracted directory.
        """
        artifacts = []
        
        # Categorize files based on UAC directory structure
        category_patterns = {
            "live_response": ["live_response", "process", "network", "users", "system"],
            "bodyfile": ["bodyfile"],
            "logs": ["logs", "var/log", "log/"],
            "configuration": ["etc", "config"],
            "hash_data": ["hash"],
            "persistence": ["cron", "systemd", "init.d"],
            "authentication": ["auth", "ssh", "pam"],
        }
        
        for file_path in extract_dir.rglob("*"):
            if file_path.is_file():
                relative_path = file_path.relative_to(extract_dir)
                category = self._categorize_artifact(str(relative_path), category_patterns)
                
                artifacts.append({
                    "path": str(relative_path),
                    "category": category,
                    "size": file_path.stat().st_size,
                    "name": file_path.name
                })
        
        return artifacts
    
    def _categorize_artifact(self, path: str, patterns: dict) -> str:
        """Determine artifact category based on path patterns."""
        path_lower = path.lower()
        for category, keywords in patterns.items():
            if any(keyword in path_lower for keyword in keywords):
                return category
        return "other"
    
    def _generate_summary(self, artifacts: list[dict], rag_stats: dict) -> dict:
        """Generate summary statistics from artifacts."""
        categories = {}
        for artifact in artifacts:
            cat = artifact["category"]
            categories[cat] = categories.get(cat, 0) + 1
        
        return {
            "total_artifacts": len(artifacts),
            "total_chunks": rag_stats.get("chunks_created", 0),
            "total_tokens": rag_stats.get("total_tokens", 0),
            "categories": categories,
            "chunk_categories": rag_stats.get("by_category", {}),
            "files_processed": rag_stats.get("files_processed", 0),
            "files_skipped": rag_stats.get("files_skipped", 0)
        }
    
    def _generate_preview(self, artifacts: list[dict]) -> list[dict]:
        """Generate preview of artifacts by category."""
        preview = []
        categories_seen = set()
        
        for artifact in artifacts:
            cat = artifact["category"]
            if cat not in categories_seen:
                categories_seen.add(cat)
                count = sum(1 for a in artifacts if a["category"] == cat)
                preview.append({
                    "category": cat,
                    "name": cat.replace("_", " ").title(),
                    "count": count
                })
        
        return sorted(preview, key=lambda x: x["count"], reverse=True)
