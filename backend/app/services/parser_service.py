"""
Parser Service - Handles UAC archive extraction and parsing.

Uses tiered storage architecture per RAG_DESIGN.md:
- Tier 0: Raw archives remain in filesystem (cold storage)
- Tier 1: Parsed chunks stored in SQLite
- Tier 2: Embeddings in ChromaDB

Understands the UAC output directory structure:
- [root]/ — raw collected files (var/log, etc, home dirs)
- live_response/ — command outputs (process, network, user, system, hardware, software)
- bodyfile/ — filesystem timeline (TSK bodyfile format)
- hash_executables/ — file hashes (md5, sha1, sha256)
- memory_dump/ — volatile memory (if collected)
- uac.log — acquisition metadata
"""
import re
import tarfile
import zipfile
import hashlib
import logging
from pathlib import Path
from typing import Any, Callable
from datetime import datetime

from app.models import db, Session, Investigation, FileHash
from app.services.tiered_rag_service import TieredRAGService

logger = logging.getLogger(__name__)

# Progress callback type: (step: str, progress: int, detail: str) -> None
ProgressCallback = Callable[[str, int, str], None]

# UAC archive filename pattern: uac-<hostname>-<os>-<timestamp>.tar.gz
UAC_FILENAME_PATTERN = re.compile(
    r"uac-(?P<hostname>[^-]+)-(?P<os>[^-]+)-(?P<timestamp>\d{8,14})"
)


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
            system_info = self._extract_system_info(extract_dir, file_path.name)
            session.hostname = system_info.get("hostname")
            session.os_type = system_info.get("os_type")
            session.collection_date = system_info.get("collection_date")
            
            report("artifacts", 30, "Parsing artifacts...")
            # Parse artifacts for summary
            artifacts = self._parse_artifacts(extract_dir)
            session.total_artifacts = len(artifacts)
            
            # Parse hash executables if present
            report("hashes", 33, "Parsing file hashes...")
            db.session.commit()  # commit session first to get session.id
            hash_count = self._parse_hash_executables(extract_dir, session.id)
            
            report("ingest", 35, f"Indexing {len(artifacts)} files for RAG...")
            # Ingest into tiered RAG storage (expensive operation - done once)
            # Pass progress callback for detailed tracking during ingestion
            rag_stats = self.rag_service.ingest_session(session, extract_dir, progress_callback)
            
            # Update session with final stats
            report("finalize", 95, "Finalizing...")
            session.total_chunks = rag_stats["chunks_created"]
            # Don't override status - ingest_session sets "searchable" and background thread will set "ready"
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
    
    def _extract_system_info(self, extract_dir: Path, original_filename: str = "") -> dict:
        """
        Extract system information from UAC artifacts.
        
        Sources (in priority order):
        1. uac.log — acquisition log with profile, start/end times, UAC version
        2. Hostname/OS files from collected artifacts
        3. UAC archive filename pattern: uac-<hostname>-<os>-<timestamp>
        """
        info = {
            "hostname": None,
            "os_type": None,
            "collection_date": None,
            "uac_version": None,
            "uac_profile": None,
            "collection_start": None,
            "collection_end": None,
        }
        
        # 1. Parse uac.log for acquisition metadata
        uac_log = self._find_file(extract_dir, "uac.log")
        if uac_log:
            info.update(self._parse_uac_log(uac_log))
        
        # 2. Try hostname from collected files
        if not info["hostname"]:
            for rel in [
                "live_response/system/hostname.txt",
                "live_response/system/uname.txt",
            ]:
                f = self._find_file(extract_dir, rel)
                if f:
                    try:
                        text = f.read_text(errors="replace").strip().split("\n")[0]
                        if text:
                            info["hostname"] = text.split()[0] if "uname" in str(f) else text
                            break
                    except Exception:
                        pass
            # etc/hostname under the collected root
            if not info["hostname"]:
                for p in extract_dir.rglob("etc/hostname"):
                    try:
                        info["hostname"] = p.read_text(errors="replace").strip().split("\n")[0]
                        break
                    except Exception:
                        pass
        
        # 3. Detect OS type from collected artifacts
        if not info["os_type"]:
            os_indicators = [
                ("etc/os-release", "linux"),
                ("etc/redhat-release", "linux"),
                ("etc/debian_version", "linux"),
                ("System/Library", "macos"),
                ("private/var", "macos"),
                ("live_response/system/uname.txt", "unix"),
            ]
            for pattern, os_type in os_indicators:
                found = list(extract_dir.rglob(pattern))
                if found:
                    info["os_type"] = os_type
                    break
        
        # 4. Fall back to filename parsing
        if original_filename:
            match = UAC_FILENAME_PATTERN.search(original_filename)
            if match:
                if not info["hostname"]:
                    info["hostname"] = match.group("hostname")
                if not info["os_type"]:
                    info["os_type"] = match.group("os")
                if not info["collection_date"]:
                    ts = match.group("timestamp")
                    try:
                        if len(ts) >= 14:
                            info["collection_date"] = datetime.strptime(ts[:14], "%Y%m%d%H%M%S")
                        elif len(ts) >= 8:
                            info["collection_date"] = datetime.strptime(ts[:8], "%Y%m%d")
                    except ValueError:
                        pass
        
        # Use uac.log creation time as last resort for collection_date
        if not info["collection_date"] and uac_log:
            try:
                info["collection_date"] = datetime.fromtimestamp(uac_log.stat().st_mtime)
            except Exception:
                pass
        
        return info
    
    def _parse_uac_log(self, uac_log: Path) -> dict:
        """Parse uac.log for acquisition metadata."""
        result = {}
        try:
            content = uac_log.read_text(errors="replace")
            
            # UAC version
            m = re.search(r"UAC\s+(?:version\s+)?(\d+\.\d+[\.\d]*)", content, re.I)
            if m:
                result["uac_version"] = m.group(1)
            
            # Profile used
            m = re.search(r"(?:profile|using)\s*[:=]\s*(\S+)", content, re.I)
            if m:
                result["uac_profile"] = m.group(1)
            
            # Hostname from uac.log
            m = re.search(r"hostname\s*[:=]\s*(\S+)", content, re.I)
            if m:
                result["hostname"] = m.group(1)
            
            # Start/end timestamps
            for pattern, key in [
                (r"(?:start|started|begin)\s*(?:date|time)?\s*[:=]\s*(.+)", "collection_start"),
                (r"(?:end|finished|complete)\s*(?:date|time)?\s*[:=]\s*(.+)", "collection_end"),
            ]:
                m = re.search(pattern, content, re.I)
                if m:
                    ts_str = m.group(1).strip()
                    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%a %b %d %H:%M:%S %Z %Y"]:
                        try:
                            result[key] = datetime.strptime(ts_str[:19], fmt[:len(ts_str)])
                            break
                        except ValueError:
                            continue
            
            # Try to extract collection_date from start time
            if "collection_start" in result and "collection_date" not in result:
                result["collection_date"] = result["collection_start"]
                
        except Exception as e:
            logger.warning(f"Failed to parse uac.log: {e}")
        
        return result
    
    def _find_file(self, extract_dir: Path, relative_path: str) -> Path | None:
        """
        Find a file in the extract directory, handling nested UAC directories.
        UAC archives sometimes have a top-level folder inside.
        """
        # Direct path
        direct = extract_dir / relative_path
        if direct.exists():
            return direct
        
        # One level nested (common in UAC archives)
        for child in extract_dir.iterdir():
            if child.is_dir():
                nested = child / relative_path
                if nested.exists():
                    return nested
        
        return None
    
    def _parse_hash_executables(self, extract_dir: Path, session_id: int) -> int:
        """
        Parse hash files from UAC hash_executables directory.
        
        UAC generates hash files like:
        - hash_executables/md5.txt
        - hash_executables/sha1.txt  
        - hash_executables/sha256.txt
        
        Format: <hash>  <filepath>
        
        Returns number of hash records created.
        """
        count = 0
        hash_dirs = list(extract_dir.rglob("hash_executables"))
        
        hash_type_map = {
            "md5": "hash_md5",
            "sha1": "hash_sha1",
            "sha256": "hash_sha256",
        }
        
        # Collect all hashes by file path
        file_hashes: dict[str, dict] = {}
        
        for hash_dir in hash_dirs:
            if not hash_dir.is_dir():
                continue
            
            for hash_file in hash_dir.iterdir():
                if not hash_file.is_file():
                    continue
                
                # Determine hash type from filename
                hash_type = None
                for prefix, col_name in hash_type_map.items():
                    if prefix in hash_file.name.lower():
                        hash_type = col_name
                        break
                
                if not hash_type:
                    continue
                
                try:
                    for line in hash_file.read_text(errors="replace").splitlines():
                        line = line.strip().replace('\x00', '')
                        if not line or line.startswith("#"):
                            continue
                        # Format: <hash>  <filepath> or <hash> <filepath>
                        parts = line.split(None, 1)
                        if len(parts) == 2:
                            hash_val, fpath = parts
                            fpath = fpath.lstrip("*")  # Binary mode indicator
                            if fpath not in file_hashes:
                                file_hashes[fpath] = {"file_path": fpath}
                            file_hashes[fpath][hash_type] = hash_val
                except Exception as e:
                    logger.warning(f"Error parsing hash file {hash_file}: {e}")
        
        # Write to database in batches
        batch = []
        for fpath, hashes in file_hashes.items():
            fh = FileHash(
                session_id=session_id,
                file_path=hashes["file_path"],
                hash_md5=hashes.get("hash_md5"),
                hash_sha1=hashes.get("hash_sha1"),
                hash_sha256=hashes.get("hash_sha256"),
            )
            batch.append(fh)
            if len(batch) >= 500:
                db.session.bulk_save_objects(batch)
                db.session.commit()
                count += len(batch)
                batch = []
        
        if batch:
            db.session.bulk_save_objects(batch)
            db.session.commit()
            count += len(batch)
        
        logger.info(f"Parsed {count} file hashes for session {session_id}")
        return count
    
    def _parse_artifacts(self, extract_dir: Path) -> list[dict]:
        """
        Parse artifacts from extracted directory.
        Uses the standard UAC output directory structure for categorization.
        """
        artifacts = []
        
        # UAC-aware category patterns (ordered by specificity)
        category_patterns = {
            "live_response/process": ["live_response/process"],
            "live_response/network": ["live_response/network"],
            "live_response/user": ["live_response/user"],
            "live_response/system": ["live_response/system"],
            "live_response/hardware": ["live_response/hardware"],
            "live_response/software": ["live_response/software"],
            "live_response": ["live_response"],
            "bodyfile": ["bodyfile"],
            "hash_executables": ["hash_executables", "hash_exec"],
            "memory_dump": ["memory_dump"],
            "logs": ["logs", "var/log", "log/"],
            "configuration": ["etc/", "config/"],
            "persistence": ["cron", "systemd", "init.d", "rc.d", "launchd"],
            "authentication": ["auth", "ssh", "pam", "shadow", "passwd"],
            "user_data": ["home/", "root/"],
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
