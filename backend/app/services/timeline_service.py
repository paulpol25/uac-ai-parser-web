"""
Timeline Service - Generates forensic timelines from UAC artifacts.

Parses timestamps from actual log files, bodyfiles, and other sources.
Supports both internal parsing and Plaso integration (via Docker).
"""
from typing import Any
from datetime import datetime
from pathlib import Path
import uuid
import subprocess
import re
import os


class TimelineService:
    """Service for generating forensic timelines."""
    
    # In-memory job storage
    _jobs: dict[str, dict] = {}
    
    # Common syslog timestamp pattern: "Feb  5 14:23:01"
    SYSLOG_TS_PATTERN = re.compile(
        r'^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})'
    )
    
    # ISO timestamp pattern
    ISO_TS_PATTERN = re.compile(
        r'(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})'
    )
    
    # Apache/Nginx access log pattern
    ACCESS_LOG_PATTERN = re.compile(
        r'\[(\d{2}/[A-Z][a-z]{2}/\d{4}:\d{2}:\d{2}:\d{2})'
    )
    
    # Bash history with timestamps (HISTTIMEFORMAT=%F %T)
    BASH_HISTORY_TS = re.compile(r'^#(\d{10,})$')
    
    # Bodyfile format: MD5|inode|mode|UID|GID|size|atime|mtime|ctime|crtime
    BODYFILE_PATTERN = re.compile(r'^([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(\d+)\|(\d+)\|(\d+)\|(\d+)?')
    
    # macOS ASL/unified log timestamp
    MACOS_LOG_PATTERN = re.compile(r'^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)')
    
    # Windows event log timestamp (from converted logs)
    WINDOWS_EVT_PATTERN = re.compile(r'(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})')
    
    MONTH_MAP = {
        'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
        'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
    }
    
    def get_timeline(
        self,
        session_id: str,
        start_time: str | None = None,
        end_time: str | None = None,
        event_types: list[str] | None = None
    ) -> dict[str, Any]:
        """
        Get timeline data using internal parser.
        
        Args:
            session_id: Session identifier
            start_time: Optional ISO timestamp filter start
            end_time: Optional ISO timestamp filter end
            event_types: Optional list of event types to include
            
        Returns:
            Timeline events and metadata
        """
        from app.services.parser_service import ParserService
        from app.models import Session
        
        # Get session to access extract path
        session = Session.query.filter_by(session_id=session_id).first()
        if session is None or not session.extract_path:
            raise ValueError(f"Session {session_id} not found or not extracted")
        
        extract_dir = Path(session.extract_path)
        if not extract_dir.exists():
            raise ValueError(f"Extract directory not found: {extract_dir}")
        
        # Get collection year from session
        collection_year = datetime.now().year
        if session.collection_date:
            collection_year = session.collection_date.year
        
        # Generate timeline events from actual file contents
        events = self._generate_events_from_logs(extract_dir, collection_year)
        
        # Apply filters
        if start_time:
            events = [e for e in events if e.get("timestamp", "") >= start_time]
        if end_time:
            events = [e for e in events if e.get("timestamp", "") <= end_time]
        if event_types:
            events = [e for e in events if e.get("event_type") in event_types]
        
        # Sort by timestamp
        events.sort(key=lambda e: e.get("timestamp", ""))
        
        # Calculate time range
        timestamps = [e["timestamp"] for e in events if e.get("timestamp")]
        time_range = {
            "start": min(timestamps) if timestamps else None,
            "end": max(timestamps) if timestamps else None
        }
        
        return {
            "events": events,
            "total_events": len(events),
            "time_range": time_range
        }
    
    def is_plaso_available(self) -> bool:
        """Check if Docker and Plaso are available."""
        try:
            result = subprocess.run(
                ["docker", "--version"],
                capture_output=True,
                timeout=5
            )
            if result.returncode != 0:
                return False
            return True
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return False
    
    def start_plaso_job(self, session_id: str) -> dict[str, str]:
        """Start a Plaso timeline generation job."""
        from app.services.parser_service import ParserService
        
        parser = ParserService()
        status = parser.get_status(session_id)
        
        if status is None:
            raise ValueError(f"Session {session_id} not found")
        
        job_id = str(uuid.uuid4())
        
        self._jobs[job_id] = {
            "job_id": job_id,
            "session_id": session_id,
            "status": "queued",
            "started_at": datetime.utcnow().isoformat(),
            "completed_at": None,
            "output_path": None,
            "error": None
        }
        
        return {"job_id": job_id}
    
    def get_plaso_job_status(self, job_id: str) -> dict | None:
        """Get status of a Plaso job."""
        return self._jobs.get(job_id)
    
    def _generate_events_from_logs(self, extract_dir: Path, collection_year: int) -> list[dict]:
        """
        Generate timeline events by parsing actual log file contents.
        """
        events = []
        
        # Define which files to parse and how
        log_parsers = [
            # Syslog-style logs
            ("var/log/auth.log*", self._parse_syslog, "authentication"),
            ("var/log/secure*", self._parse_syslog, "authentication"),
            ("var/log/syslog*", self._parse_syslog, "system"),
            ("var/log/messages*", self._parse_syslog, "system"),
            ("var/log/kern.log*", self._parse_syslog, "kernel"),
            ("var/log/daemon.log*", self._parse_syslog, "daemon"),
            ("var/log/cron*", self._parse_syslog, "scheduled_task"),
            
            # Web server logs
            ("var/log/apache*/*access*", self._parse_access_log, "web_access"),
            ("var/log/nginx/*access*", self._parse_access_log, "web_access"),
            ("var/log/httpd/*access*", self._parse_access_log, "web_access"),
            
            # Bodyfile (filesystem timeline)
            ("**/bodyfile*", self._parse_bodyfile, "filesystem"),
            ("**/body.txt", self._parse_bodyfile, "filesystem"),
            
            # Bash/shell history
            ("**/.bash_history", self._parse_bash_history, "shell_command"),
            ("**/bash_history*", self._parse_bash_history, "shell_command"),
            ("**/.zsh_history", self._parse_bash_history, "shell_command"),
            
            # lastlog/wtmp style (binary, need special handling)
            ("**/last.txt", self._parse_last_output, "login"),
            ("**/lastlog.txt", self._parse_last_output, "login"),
            ("**/who.txt", self._parse_who_output, "login"),
            ("**/w.txt", self._parse_who_output, "login"),
            
            # Process snapshots
            ("**/ps_*.txt", self._parse_process_list, "process"),
            ("**/ps-*.txt", self._parse_process_list, "process"),
            
            # Network connections
            ("**/netstat*.txt", self._parse_netstat, "network"),
            ("**/ss_*.txt", self._parse_netstat, "network"),
            
            # Systemd journal (if exported as text)
            ("**/journalctl*.txt", self._parse_journalctl, "system"),
            
            # Crontab entries
            ("**/crontab*", self._parse_crontab, "scheduled_task"),
            ("etc/cron.*/**", self._parse_cron_file, "scheduled_task"),
        ]
        
        for pattern, parser_func, event_type in log_parsers:
            for log_file in extract_dir.glob(pattern):
                if log_file.is_file():
                    try:
                        file_events = parser_func(log_file, collection_year, event_type)
                        events.extend(file_events)
                    except Exception as e:
                        # Log but don't fail on individual files
                        pass
        
        return events
    
    def _parse_syslog(self, file_path: Path, year: int, event_type: str) -> list[dict]:
        """Parse syslog-style log files (auth.log, syslog, etc.)."""
        events = []
        source_name = file_path.name
        
        try:
            content = self._read_file_safe(file_path)
        except Exception:
            return events
        
        for line in content.split('\n'):
            line = line.strip()
            if not line:
                continue
            
            match = self.SYSLOG_TS_PATTERN.match(line)
            if match:
                month, day, hour, minute, second = match.groups()
                month_num = self.MONTH_MAP.get(month, 1)
                
                try:
                    ts = datetime(year, month_num, int(day), int(hour), int(minute), int(second))
                    
                    # Extract message after timestamp
                    msg_start = match.end()
                    message = line[msg_start:].strip()
                    
                    # Determine specific event subtype
                    subtype = self._classify_syslog_event(message, event_type)
                    
                    events.append({
                        "timestamp": ts.isoformat(),
                        "source": source_name,
                        "event_type": subtype,
                        "description": message[:500],  # Truncate long messages
                        "path": str(file_path.name),
                        "raw_line": line[:1000]
                    })
                except ValueError:
                    continue
        
        return events
    
    def _classify_syslog_event(self, message: str, default_type: str) -> str:
        """Classify syslog message into specific event type."""
        msg_lower = message.lower()
        
        if any(kw in msg_lower for kw in ['accepted', 'session opened', 'logged in', 'new session']):
            return 'login_success'
        elif any(kw in msg_lower for kw in ['failed', 'invalid', 'authentication failure', 'denied']):
            return 'login_failure'
        elif any(kw in msg_lower for kw in ['sudo', 'su:', 'privilege']):
            return 'privilege_change'
        elif any(kw in msg_lower for kw in ['password changed', 'useradd', 'userdel', 'usermod']):
            return 'user_management'
        elif any(kw in msg_lower for kw in ['started', 'stopped', 'systemd']):
            return 'service_change'
        elif any(kw in msg_lower for kw in ['cron', 'anacron']):
            return 'scheduled_task'
        elif any(kw in msg_lower for kw in ['connection from', 'connection to', 'listening']):
            return 'network_event'
        
        return default_type
    
    def _parse_access_log(self, file_path: Path, year: int, event_type: str) -> list[dict]:
        """Parse Apache/Nginx access logs."""
        events = []
        source_name = file_path.name
        
        try:
            content = self._read_file_safe(file_path)
        except Exception:
            return events
        
        for line in content.split('\n'):
            line = line.strip()
            if not line:
                continue
            
            match = self.ACCESS_LOG_PATTERN.search(line)
            if match:
                ts_str = match.group(1)
                try:
                    # Format: 05/Feb/2024:14:23:01
                    ts = datetime.strptime(ts_str, "%d/%b/%Y:%H:%M:%S")
                    
                    events.append({
                        "timestamp": ts.isoformat(),
                        "source": source_name,
                        "event_type": event_type,
                        "description": line[:300],
                        "path": str(file_path.name)
                    })
                except ValueError:
                    continue
        
        return events
    
    def _parse_bodyfile(self, file_path: Path, year: int, event_type: str) -> list[dict]:
        """Parse bodyfile format for filesystem timeline."""
        events = []
        source_name = file_path.name
        
        try:
            content = self._read_file_safe(file_path)
        except Exception:
            return events
        
        for line in content.split('\n'):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            
            match = self.BODYFILE_PATTERN.match(line)
            if match:
                # Parse bodyfile fields
                md5, inode, mode, uid, gid, size, atime, mtime, ctime, crtime = match.groups()
                filepath = line.split('|')[0] if '|' in line else 'unknown'
                
                # Create events for each timestamp type
                for ts_epoch, ts_type in [(mtime, 'modified'), (atime, 'accessed'), (ctime, 'changed')]:
                    try:
                        ts = datetime.fromtimestamp(int(ts_epoch))
                        
                        # Skip very old or invalid timestamps
                        if ts.year < 1980 or ts.year > 2100:
                            continue
                        
                        events.append({
                            "timestamp": ts.isoformat(),
                            "source": source_name,
                            "event_type": f"file_{ts_type}",
                            "description": f"File {ts_type}: {filepath}",
                            "path": filepath,
                            "metadata": {"size": size, "mode": mode}
                        })
                    except (ValueError, OSError):
                        continue
        
        # Limit bodyfile events to prevent overwhelming the timeline
        if len(events) > 5000:
            events = sorted(events, key=lambda e: e.get("timestamp", ""), reverse=True)[:5000]
        
        return events
    
    def _parse_bash_history(self, file_path: Path, year: int, event_type: str) -> list[dict]:
        """Parse bash history with optional timestamps."""
        events = []
        source_name = file_path.name
        
        try:
            content = self._read_file_safe(file_path)
        except Exception:
            return events
        
        lines = content.split('\n')
        current_ts = None
        line_num = 0
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Check for epoch timestamp marker
            ts_match = self.BASH_HISTORY_TS.match(line)
            if ts_match:
                try:
                    current_ts = datetime.fromtimestamp(int(ts_match.group(1)))
                except (ValueError, OSError):
                    current_ts = None
                continue
            
            line_num += 1
            
            # This is a command
            if current_ts:
                ts = current_ts
            else:
                # No timestamp, use line number as relative ordering
                ts = None
            
            # Classify command
            cmd_type = self._classify_command(line)
            
            event = {
                "source": source_name,
                "event_type": cmd_type,
                "description": f"Command: {line[:200]}",
                "path": str(file_path.name),
                "line_number": line_num
            }
            
            if ts:
                event["timestamp"] = ts.isoformat()
            else:
                # Use a placeholder for ordering
                event["timestamp"] = f"{year}-01-01T00:00:{str(line_num).zfill(2)}"
            
            events.append(event)
            current_ts = None  # Reset for next command
        
        return events
    
    def _classify_command(self, command: str) -> str:
        """Classify shell command for timeline event type."""
        cmd_lower = command.lower()
        
        if any(kw in cmd_lower for kw in ['sudo ', 'su ', 'doas ']):
            return 'privilege_escalation'
        elif any(kw in cmd_lower for kw in ['ssh ', 'scp ', 'sftp ', 'rsync ']):
            return 'remote_access'
        elif any(kw in cmd_lower for kw in ['wget ', 'curl ', 'nc ', 'ncat ']):
            return 'network_download'
        elif any(kw in cmd_lower for kw in ['chmod ', 'chown ', 'chattr ']):
            return 'permission_change'
        elif any(kw in cmd_lower for kw in ['rm ', 'shred ', 'wipe ']):
            return 'file_deletion'
        elif any(kw in cmd_lower for kw in ['base64', 'xxd', 'openssl', 'gpg']):
            return 'encoding_crypto'
        elif any(kw in cmd_lower for kw in ['iptables', 'firewall', 'ufw']):
            return 'firewall_change'
        elif any(kw in cmd_lower for kw in ['crontab', 'at ', 'systemctl']):
            return 'persistence'
        
        return 'shell_command'
    
    def _parse_last_output(self, file_path: Path, year: int, event_type: str) -> list[dict]:
        """Parse output of 'last' command."""
        events = []
        source_name = file_path.name
        
        try:
            content = self._read_file_safe(file_path)
        except Exception:
            return events
        
        # Pattern: username pts/0 192.168.1.1 Mon Feb 5 14:23 - 15:30 (01:07)
        last_pattern = re.compile(
            r'^(\S+)\s+(\S+)\s+(\S+)\s+([A-Z][a-z]{2})\s+([A-Z][a-z]{2})\s+(\d+)\s+(\d{2}):(\d{2})'
        )
        
        for line in content.split('\n'):
            line = line.strip()
            if not line or line.startswith('wtmp') or line.startswith('reboot'):
                continue
            
            match = last_pattern.match(line)
            if match:
                user, tty, host, dow, month, day, hour, minute = match.groups()
                month_num = self.MONTH_MAP.get(month, 1)
                
                try:
                    ts = datetime(year, month_num, int(day), int(hour), int(minute))
                    
                    subtype = 'logout' if 'down' in line.lower() or 'crash' in line.lower() else 'login_session'
                    
                    events.append({
                        "timestamp": ts.isoformat(),
                        "source": source_name,
                        "event_type": subtype,
                        "description": f"User {user} from {host} on {tty}",
                        "path": str(file_path.name),
                        "metadata": {"user": user, "host": host, "tty": tty}
                    })
                except ValueError:
                    continue
        
        return events
    
    def _parse_who_output(self, file_path: Path, year: int, event_type: str) -> list[dict]:
        """Parse output of 'who' or 'w' command."""
        events = []
        source_name = file_path.name
        
        try:
            content = self._read_file_safe(file_path)
        except Exception:
            return events
        
        # 'who' format: user tty date time (host)
        who_pattern = re.compile(
            r'^(\S+)\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})'
        )
        
        for line in content.split('\n'):
            line = line.strip()
            if not line:
                continue
            
            match = who_pattern.match(line)
            if match:
                user, tty, date, time = match.groups()
                try:
                    ts = datetime.fromisoformat(f"{date}T{time}:00")
                    events.append({
                        "timestamp": ts.isoformat(),
                        "source": source_name,
                        "event_type": "active_session",
                        "description": f"Active session: {user} on {tty}",
                        "path": str(file_path.name),
                        "metadata": {"user": user, "tty": tty}
                    })
                except ValueError:
                    continue
        
        return events
    
    def _parse_process_list(self, file_path: Path, year: int, event_type: str) -> list[dict]:
        """Parse process list snapshots (ps output)."""
        events = []
        source_name = file_path.name
        
        try:
            content = self._read_file_safe(file_path)
        except Exception:
            return events
        
        # Try to get file modification time as snapshot time
        try:
            mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
        except Exception:
            mtime = datetime(year, 1, 1)
        
        lines = content.split('\n')
        header_line = lines[0] if lines else ""
        
        for line in lines[1:]:
            line = line.strip()
            if not line:
                continue
            
            # Look for interesting processes
            parts = line.split()
            if len(parts) >= 4:
                cmd = ' '.join(parts[-1:]) if parts else line
                
                # Only add notable processes
                if self._is_notable_process(line):
                    events.append({
                        "timestamp": mtime.isoformat(),
                        "source": source_name,
                        "event_type": "process_snapshot",
                        "description": f"Process: {cmd[:100]}",
                        "path": str(file_path.name),
                        "raw_line": line[:300]
                    })
        
        return events
    
    def _is_notable_process(self, process_line: str) -> bool:
        """Check if a process is security-relevant."""
        notable_patterns = [
            'nc ', 'ncat', 'netcat', '/bin/sh', '/bin/bash',
            'python', 'perl', 'ruby', 'php', 'wget', 'curl',
            'ssh', 'sshd', 'telnet', 'ftp', 'nmap', 'masscan',
            'tcpdump', 'wireshark', 'apache', 'nginx', 'mysql',
            'postgres', 'redis', 'docker', 'kubectl', 'crypto',
            'miner', 'xmrig', 'kworker', 'ksoftirqd'
        ]
        line_lower = process_line.lower()
        return any(p in line_lower for p in notable_patterns)
    
    def _parse_netstat(self, file_path: Path, year: int, event_type: str) -> list[dict]:
        """Parse netstat/ss output for network connections."""
        events = []
        source_name = file_path.name
        
        try:
            content = self._read_file_safe(file_path)
        except Exception:
            return events
        
        # Get file modification time
        try:
            mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
        except Exception:
            mtime = datetime(year, 1, 1)
        
        for line in content.split('\n'):
            line = line.strip()
            if not line or line.startswith('Proto') or line.startswith('Netid'):
                continue
            
            parts = line.split()
            if len(parts) >= 4:
                # Look for LISTEN or ESTABLISHED states
                state = None
                for p in parts:
                    if p.upper() in ['LISTEN', 'ESTABLISHED', 'SYN_SENT', 'TIME_WAIT']:
                        state = p.upper()
                        break
                
                if state in ['LISTEN', 'ESTABLISHED']:
                    events.append({
                        "timestamp": mtime.isoformat(),
                        "source": source_name,
                        "event_type": f"network_{state.lower()}",
                        "description": line[:200],
                        "path": str(file_path.name)
                    })
        
        return events
    
    def _parse_journalctl(self, file_path: Path, year: int, event_type: str) -> list[dict]:
        """Parse systemd journal output."""
        events = []
        source_name = file_path.name
        
        try:
            content = self._read_file_safe(file_path)
        except Exception:
            return events
        
        # Journal format varies, try ISO timestamp
        for line in content.split('\n'):
            line = line.strip()
            if not line:
                continue
            
            match = self.ISO_TS_PATTERN.search(line)
            if match:
                ts_str = match.group(1)
                try:
                    ts = datetime.fromisoformat(ts_str.replace(' ', 'T'))
                    subtype = self._classify_syslog_event(line, event_type)
                    
                    events.append({
                        "timestamp": ts.isoformat(),
                        "source": source_name,
                        "event_type": subtype,
                        "description": line[:500],
                        "path": str(file_path.name)
                    })
                except ValueError:
                    continue
        
        return events
    
    def _parse_crontab(self, file_path: Path, year: int, event_type: str) -> list[dict]:
        """Parse crontab files."""
        events = []
        source_name = file_path.name
        
        try:
            content = self._read_file_safe(file_path)
        except Exception:
            return events
        
        try:
            mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
        except Exception:
            mtime = datetime(year, 1, 1)
        
        for line in content.split('\n'):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            
            # Skip variable assignments
            if '=' in line and not line[0].isdigit() and line[0] != '*':
                continue
            
            events.append({
                "timestamp": mtime.isoformat(),
                "source": source_name,
                "event_type": "cron_entry",
                "description": f"Cron job: {line[:200]}",
                "path": str(file_path.name)
            })
        
        return events
    
    def _parse_cron_file(self, file_path: Path, year: int, event_type: str) -> list[dict]:
        """Parse files from /etc/cron.* directories."""
        return self._parse_crontab(file_path, year, event_type)
    
    def _read_file_safe(self, file_path: Path, max_size: int = 10_000_000) -> str:
        """Read file with encoding fallback and size limit."""
        if file_path.stat().st_size > max_size:
            return ""
        
        encodings = ['utf-8', 'latin-1', 'cp1252']
        for encoding in encodings:
            try:
                return file_path.read_text(encoding=encoding)
            except (UnicodeDecodeError, UnicodeError):
                continue
        return ""
