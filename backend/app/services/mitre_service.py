"""
MITRE ATT&CK Mapping Service.

Maps detected behaviors in forensic artifacts to MITRE ATT&CK techniques.
Uses pattern-based detection from parsed artifacts — no LLM calls needed.

Covers the most relevant techniques for Linux/Unix forensics (~50 techniques).
"""
import re
import logging
from datetime import datetime
from typing import Optional

from app.models import db, MitreMapping, Chunk

logger = logging.getLogger(__name__)


# ── Technique Definitions ──────────────────────────────────────────
# Each entry: (technique_id, technique_name, tactic, detection_patterns, confidence)
# Patterns are checked against chunk content (case-insensitive)

TECHNIQUE_RULES: list[tuple[str, str, str, list[str], float]] = [
    # Initial Access
    ("T1078", "Valid Accounts", "initial-access", [
        r"accepted\s+(?:password|publickey)\s+for\s+\w+\s+from",
        r"session\s+opened\s+for\s+user\s+\w+\s+by",
        r"new\s+session\s+\d+\s+of\s+user",
    ], 0.5),
    ("T1133", "External Remote Services", "initial-access", [
        r"sshd\[\d+\]:\s+Accepted",
        r"connection\s+from\s+\d+\.\d+\.\d+\.\d+\s+port\s+\d+",
    ], 0.5),
    
    # Execution
    ("T1059.004", "Unix Shell", "execution", [
        r"/bin/(?:ba)?sh\s+-c\s+",
        r"bash\s+-i\s+",
        r"sh\s+-c\s+['\"]",
    ], 0.6),
    ("T1059.006", "Python", "execution", [
        r"python[23]?\s+-c\s+['\"]",
        r"python[23]?\s+.*\.py",
        r"import\s+(?:os|subprocess|socket)\s*;",
    ], 0.5),
    ("T1053.003", "Cron", "execution", [
        r"crontab\s+-[el]",
        r"\*/\d+\s+\*\s+\*\s+\*\s+\*",
        r"(?:etc|var/spool)/cron",
    ], 0.7),
    ("T1059.001", "PowerShell (via Python/Perl)", "execution", [
        r"perl\s+-e\s+['\"]",
        r"ruby\s+-e\s+['\"]",
    ], 0.4),
    
    # Persistence
    ("T1053.003", "Scheduled Task/Job: Cron", "persistence", [
        r"crontab\s+",
        r"/etc/cron\.",
        r"/var/spool/cron/",
    ], 0.7),
    ("T1543.002", "Systemd Service", "persistence", [
        r"systemctl\s+(?:enable|start|daemon-reload)",
        r"/etc/systemd/system/.*\.service",
        r"\[Service\].*ExecStart",
    ], 0.7),
    ("T1546.004", "Unix Shell Config Modification", "persistence", [
        r"\.bashrc|\.bash_profile|\.profile|\.zshrc",
        r"echo\s+.*>>\s*~/?\.",
    ], 0.6),
    ("T1098.004", "SSH Authorized Keys", "persistence", [
        r"authorized_keys",
        r"ssh-(?:rsa|ed25519|ecdsa)\s+AAAA",
    ], 0.8),
    ("T1136.001", "Create Account: Local Account", "persistence", [
        r"useradd\s+",
        r"adduser\s+",
        r"usermod\s+-aG",
    ], 0.7),
    ("T1543.001", "Launch Agent/Daemon", "persistence", [
        r"LaunchAgents|LaunchDaemons",
        r"com\.apple\.\w+\.plist",
    ], 0.6),
    
    # Privilege Escalation
    ("T1548.001", "Setuid and Setgid", "privilege-escalation", [
        r"chmod\s+[ugo]*\+s\s+",
        r"chmod\s+[4267]\d{3}\s+",
        r"-rwsr-",
    ], 0.7),
    ("T1548.003", "Sudo and Sudo Caching", "privilege-escalation", [
        r"sudo\s+",
        r"/etc/sudoers",
        r"NOPASSWD",
    ], 0.5),
    ("T1068", "Exploitation for Privilege Escalation", "privilege-escalation", [
        r"kernel\s+exploit",
        r"dirty\s*(?:cow|pipe)",
        r"CVE-\d{4}-\d+",
    ], 0.4),
    
    # Defense Evasion
    ("T1070.002", "Clear Linux/Mac System Logs", "defense-evasion", [
        r"(?:truncate|>)\s+/var/log/",
        r"rm\s+(?:-[rf]+\s+)?/var/log/",
        r"shred\s+/var/log/",
        r"journalctl\s+--rotate\s+--vacuum",
    ], 0.8),
    ("T1070.003", "Clear Command History", "defense-evasion", [
        r"history\s+-c",
        r"unset\s+HISTFILE",
        r"HISTSIZE=0",
        r"rm\s+.*\.bash_history",
        r"ln\s+-sf\s+/dev/null\s+.*history",
    ], 0.9),
    ("T1070.004", "File Deletion", "defense-evasion", [
        r"rm\s+-[rf]+\s+/",
        r"shred\s+",
        r"wipe\s+",
    ], 0.5),
    ("T1070.006", "Timestomp", "defense-evasion", [
        r"touch\s+-[trd]\s+",
        r"touch\s+--reference",
    ], 0.8),
    ("T1036", "Masquerading", "defense-evasion", [
        r"\[kworker/\d+\]",
        r"/tmp/\.\w+",
        r"/dev/shm/\.\w+",
    ], 0.4),
    ("T1027", "Obfuscated Files or Information", "defense-evasion", [
        r"base64\s+-d\s+",
        r"base64\s+--decode",
        r"openssl\s+enc\s+-",
        r"echo\s+.*\|\s*base64\s+-d",
    ], 0.7),
    
    # Credential Access
    ("T1003.008", "/etc/passwd and /etc/shadow", "credential-access", [
        r"cat\s+/etc/(?:shadow|passwd)",
        r"unshadow\s+",
        r"john\s+.*shadow",
    ], 0.8),
    ("T1552.001", "Credentials In Files", "credential-access", [
        r"password\s*[=:]\s*\S+",
        r"(?:api[_-]?key|secret|token)\s*[=:]\s*\S+",
        r"\.(?:env|netrc|pgpass|my\.cnf)\b",
    ], 0.4),
    ("T1110", "Brute Force", "credential-access", [
        r"Failed\s+password.*from\s+\d+\.\d+\.\d+\.\d+",
        r"authentication\s+failure\s+.*rhost=",
        r"pam_unix.*failed",
    ], 0.6),
    
    # Discovery
    ("T1082", "System Information Discovery", "discovery", [
        r"uname\s+-a",
        r"cat\s+/etc/(?:os-release|issue|hostname)",
        r"hostnamectl\b",
    ], 0.5),
    ("T1083", "File and Directory Discovery", "discovery", [
        r"find\s+/\s+-(?:name|type|perm)",
        r"ls\s+-[la]+R?\s+/",
        r"tree\s+/",
    ], 0.4),
    ("T1057", "Process Discovery", "discovery", [
        r"ps\s+(?:aux|ef)",
        r"top\s+-bn",
        r"/proc/\d+/(?:cmdline|status)",
    ], 0.4),
    ("T1049", "System Network Connections Discovery", "discovery", [
        r"netstat\s+-[atnlp]+",
        r"ss\s+-[atnlp]+",
        r"lsof\s+-i",
    ], 0.4),
    ("T1016", "System Network Configuration Discovery", "discovery", [
        r"ifconfig\b",
        r"ip\s+(?:addr|route|link)",
        r"cat\s+/etc/resolv\.conf",
    ], 0.4),
    ("T1087.001", "Local Account Discovery", "discovery", [
        r"cat\s+/etc/passwd",
        r"getent\s+passwd",
        r"who\b",
        r"last\b",
    ], 0.4),
    ("T1518", "Software Discovery", "discovery", [
        r"dpkg\s+-[l]",
        r"rpm\s+-qa",
        r"apt\s+list\s+--installed",
    ], 0.3),
    
    # Lateral Movement
    ("T1021.004", "SSH", "lateral-movement", [
        r"ssh\s+\w+@\d+\.\d+\.\d+\.\d+",
        r"ssh\s+-[iLR]\s+",
        r"scp\s+.*@.*:",
    ], 0.5),
    ("T1021.002", "SMB/Windows Admin Shares", "lateral-movement", [
        r"smbclient\s+",
        r"mount\s+-t\s+cifs",
    ], 0.5),
    
    # Collection
    ("T1560.001", "Archive via Utility", "collection", [
        r"tar\s+(?:c|x)z?f?\s+",
        r"zip\s+-r?\s+",
        r"gzip\s+",
    ], 0.3),
    ("T1005", "Data from Local System", "collection", [
        r"cat\s+.*(?:\.conf|\.key|\.pem|id_rsa)",
        r"cp\s+.*(?:\.conf|\.key|\.db)\s+",
    ], 0.4),
    
    # Exfiltration
    ("T1048", "Exfiltration Over Alternative Protocol", "exfiltration", [
        r"curl\s+.*-[FdT]\s+",
        r"wget\s+--post-(?:data|file)",
        r"nc\s+-[w]?\s*\d+\.\d+\.\d+\.\d+\s+\d+\s*<",
    ], 0.5),
    
    # Command and Control
    ("T1071.001", "Web Protocols", "command-and-control", [
        r"curl\s+https?://",
        r"wget\s+https?://",
        r"python.*requests\.get\(",
    ], 0.3),
    ("T1572", "Protocol Tunneling", "command-and-control", [
        r"ssh\s+-[DLNR]\s+",
        r"socat\s+",
        r"ngrok\s+",
    ], 0.6),
    ("T1571", "Non-Standard Port", "command-and-control", [
        r"ESTABLISHED\s+\d+\.\d+\.\d+\.\d+:(?:4444|5555|8888|9999|1337)\b",
        r"LISTEN\s+\d+\.\d+\.\d+\.\d+:(?:4444|5555|8888|9999|1337)\b",
    ], 0.6),
    ("T1095", "Non-Application Layer Protocol", "command-and-control", [
        r"icmp\s+.*echo",
        r"ping\s+-c\s+\d+\s+",
    ], 0.2),
    
    # Impact
    ("T1485", "Data Destruction", "impact", [
        r"rm\s+-rf\s+/(?!proc|sys|dev\b)",
        r"dd\s+if=/dev/(?:zero|urandom)\s+of=/",
        r"mkfs\s+",
    ], 0.7),
    ("T1486", "Data Encrypted for Impact", "impact", [
        r"openssl\s+enc\s+-aes",
        r"gpg\s+--encrypt",
        r"\.encrypted\b",
    ], 0.5),
    ("T1489", "Service Stop", "impact", [
        r"systemctl\s+stop\s+",
        r"service\s+\w+\s+stop",
        r"kill\s+-9\s+",
    ], 0.4),
]


class MitreService:
    """Service for mapping forensic artifacts to MITRE ATT&CK techniques."""
    
    def scan_session(self, session_id: int) -> list[dict]:
        """
        Scan all chunks in a session for MITRE ATT&CK technique indicators.
        Creates MitreMapping records in the database.
        
        Returns list of detected techniques with evidence.
        """
        chunks = Chunk.query.filter_by(session_id=session_id).all()
        if not chunks:
            return []
        
        detections: dict[str, dict] = {}  # technique_id -> best detection
        
        for chunk in chunks:
            content = chunk.content
            for tech_id, tech_name, tactic, patterns, base_confidence in TECHNIQUE_RULES:
                for pattern in patterns:
                    match = re.search(pattern, content, re.IGNORECASE)
                    if match:
                        key = f"{tech_id}:{tactic}"
                        snippet = self._extract_evidence_snippet(content, match)
                        
                        # Keep the highest-confidence match per technique+tactic
                        if key not in detections or base_confidence > detections[key]["confidence"]:
                            detections[key] = {
                                "technique_id": tech_id,
                                "technique_name": tech_name,
                                "tactic": tactic,
                                "confidence": base_confidence,
                                "evidence_chunk_id": chunk.chunk_id,
                                "evidence_snippet": snippet,
                            }
                        break  # One match per technique per chunk is enough
        
        # Persist to database
        results = []
        for det in detections.values():
            mapping = MitreMapping(
                session_id=session_id,
                technique_id=det["technique_id"],
                technique_name=det["technique_name"],
                tactic=det["tactic"],
                confidence=det["confidence"],
                evidence_chunk_id=det["evidence_chunk_id"],
                evidence_snippet=det["evidence_snippet"],
            )
            db.session.add(mapping)
            results.append(det)
        
        db.session.commit()
        logger.info(f"MITRE scan: {len(results)} technique(s) detected for session {session_id}")
        return results
    
    def get_session_mappings(self, session_id: int) -> list[dict]:
        """Get all MITRE mappings for a session."""
        mappings = MitreMapping.query.filter_by(session_id=session_id).all()
        return [
            {
                "technique_id": m.technique_id,
                "technique_name": m.technique_name,
                "tactic": m.tactic,
                "confidence": m.confidence,
                "evidence_snippet": m.evidence_snippet,
            }
            for m in mappings
        ]
    
    def get_session_summary(self, session_id: int) -> dict:
        """Get MITRE ATT&CK summary grouped by tactic."""
        mappings = MitreMapping.query.filter_by(session_id=session_id).all()
        
        by_tactic: dict[str, list] = {}
        for m in mappings:
            by_tactic.setdefault(m.tactic, []).append({
                "technique_id": m.technique_id,
                "technique_name": m.technique_name,
                "confidence": m.confidence,
            })
        
        return {
            "total_techniques": len(mappings),
            "tactics": by_tactic,
            "tactic_count": {k: len(v) for k, v in by_tactic.items()},
        }
    
    def _extract_evidence_snippet(self, content: str, match: re.Match, context: int = 80) -> str:
        """Extract evidence snippet around a regex match."""
        start = max(0, match.start() - context)
        end = min(len(content), match.end() + context)
        snippet = content[start:end].strip()
        if start > 0:
            snippet = "..." + snippet
        if end < len(content):
            snippet = snippet + "..."
        return snippet
