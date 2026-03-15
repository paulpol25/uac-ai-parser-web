"""
Entity Extractor for UAC Forensic Artifacts.

Fast, regex-based extraction of forensically relevant entities.
No LLM calls - pure pattern matching for:
- Privacy: Works locally, no data sent to external services
- Speed: Regex is much faster than LLM inference
- Reliability: Deterministic extraction

Entity types extracted:
- IP addresses (IPv4 and IPv6)
- Domain names
- URLs (http/https)
- Email addresses
- Usernames (from common formats)
- File paths (Unix-style)
- Commands (common shell commands)
- Timestamps (various log formats)
- Ports
- Hashes (MD5, SHA1, SHA256)
- MAC addresses
- Process IDs (PIDs)
- Service names
- Cron expressions
- Base64 encoded strings (potential obfuscation)
- SSH key fingerprints
- Environment variables
"""
import re
from typing import Generator
from dataclasses import dataclass


@dataclass
class ExtractedEntity:
    """Represents a single extracted entity."""
    entity_type: str
    value: str
    normalized_value: str
    context_snippet: str
    start_pos: int
    end_pos: int


class EntityExtractor:
    """
    High-performance regex-based entity extractor.
    
    Designed for bulk extraction during ingestion.
    Thread-safe (no mutable state after init).
    """
    
    # Precompiled regex patterns for speed
    PATTERNS = {
        # IPv4 addresses (with word boundaries to avoid partial matches)
        'ipv4': re.compile(
            r'\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}'
            r'(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b'
        ),
        
        # IPv6 addresses (simplified pattern)
        'ipv6': re.compile(
            r'\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|'
            r'\b(?:[0-9a-fA-F]{1,4}:){1,7}:\b|'
            r'\b(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}\b|'
            r'\b::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}\b'
        ),
        
        # URLs (http/https) - capture full URL including path/query
        'url': re.compile(
            r'https?://[^\s<>"\')\]]+',
            re.IGNORECASE
        ),
        
        # Email addresses
        'email': re.compile(
            r'\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b',
            re.IGNORECASE
        ),
        
        # Domain names (excluding common file extensions)
        'domain': re.compile(
            r'\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|edu|gov|mil|io|co|uk|de|fr|ru|cn|jp|info|biz|xyz|top|cc|pw|tk)\b',
            re.IGNORECASE
        ),
        
        # Unix file paths (absolute paths)
        'filepath': re.compile(
            r'(?:/(?:[\w.-]+))+(?:/[\w.-]*)?',
        ),
        
        # Port numbers (in context like :8080 or port 22)
        'port': re.compile(
            r'(?:port\s*[=:]?\s*|:)(\d{1,5})\b',
            re.IGNORECASE
        ),
        
        # MAC addresses (common formats)
        'mac_address': re.compile(
            r'\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\b|'
            r'\b(?:[0-9a-fA-F]{4}\.){2}[0-9a-fA-F]{4}\b'
        ),
        
        # Process IDs (PIDs) from common log formats
        'pid': re.compile(
            r'(?:pid[=:\s]+|PID[=:\s]+|\[(\d{1,7})\]|process\s+(\d{1,7}))(\d{1,7})?',
            re.IGNORECASE
        ),
        
        # Usernames from common formats
        # passwd: user:x:uid:gid:...
        # auth logs: user john, user=john, uid=1000
        'username': re.compile(
            r'(?:user(?:name)?[=:\s]+|uid[=:\s]+\d+[^:\n]*:)(\w+)|'
            r'^([a-zA-Z_][a-zA-Z0-9_-]*):x:\d+:\d+:',
            re.MULTILINE
        ),
        
        # Common shell commands (when appearing at start or after common prefixes)
        'command': re.compile(
            r'(?:^|\$\s*|>\s*|;\s*|&&\s*|\|\|\s*|`)'
            r'((?:sudo\s+)?(?:wget|curl|nc|netcat|bash|sh|python|perl|ruby|php|'
            r'chmod|chown|rm|cp|mv|cat|echo|mkdir|touch|kill|pkill|nohup|'
            r'crontab|at|systemctl|service|apt|yum|pip|npm|git|ssh|scp|rsync|'
            r'iptables|netstat|ss|ps|top|htop|lsof|find|grep|awk|sed|tar|gzip|'
            r'useradd|usermod|passwd|groupadd|visudo|mount|umount|dd|nano|vim|vi|'
            r'base64|openssl|xxd|nc|nmap|tcpdump|wireshark|hydra|john|hashcat)'
            r'(?:\s+[^\n;|&`]{1,100})?)',
            re.MULTILINE | re.IGNORECASE
        ),
        
        # Service names (from systemctl/service commands)
        'service': re.compile(
            r'(?:systemctl\s+(?:start|stop|restart|enable|disable|status)\s+|'
            r'service\s+)([a-zA-Z0-9_-]+)',
            re.IGNORECASE
        ),
        
        # Cron expressions (for persistence detection)
        'cron': re.compile(
            r'(?:^|\s)((?:\*|[0-9,\-\/]+)\s+){4,5}(?:\*|[0-9,\-\/]+)\s+[^\n]+',
            re.MULTILINE
        ),
        
        # Environment variables
        'env_var': re.compile(
            r'\$(?:HOME|USER|PATH|SHELL|PWD|TERM|LANG|DISPLAY|SSH_[A-Z_]+|'
            r'LD_PRELOAD|LD_LIBRARY_PATH|HISTFILE|HISTSIZE|PS1|EDITOR|VISUAL)\b'
        ),
        
        # Base64 encoded strings (potential obfuscation, min 20 chars)
        'base64': re.compile(
            r'\b(?:[A-Za-z0-9+/]{4}){5,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?\b'
        ),
        
        # SSH key fingerprints
        'ssh_fingerprint': re.compile(
            r'(?:SHA256|MD5):[A-Za-z0-9+/=]{32,64}|'
            r'\b(?:[0-9a-f]{2}:){15}[0-9a-f]{2}\b',
            re.IGNORECASE
        ),
        
        # User agent strings (HTTP)
        'user_agent': re.compile(
            r'(?:User-Agent:\s*|")(Mozilla/5\.0\s+\([^)]+\)[^"]{10,200})"?',
            re.IGNORECASE
        ),
        
        # macOS plist keys / Launch Agent/Daemon labels
        'plist_key': re.compile(
            r'\b(com\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+){1,5})\b'
        ),
        
        # Piped/chained commands (capture full pipeline)
        'command_pipeline': re.compile(
            r'(?:^|\$\s*|>\s*)((?:[\w/.-]+\s+[^\n|;]{0,80}\|[\s]*){1,5}[\w/.-]+\s+[^\n;|]{0,80})',
            re.MULTILINE
        ),
        
        # Timestamps from common log formats
        # Syslog: Jan 15 10:30:45
        # ISO: 2024-01-15T10:30:45
        # Apache: 15/Jan/2024:10:30:45
        'timestamp': re.compile(
            r'\b(?:'
            r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}|'
            r'\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|'
            r'\d{1,2}/\w{3}/\d{4}:\d{2}:\d{2}:\d{2}'
            r')\b',
            re.IGNORECASE
        ),
        
        # Hashes (MD5, SHA1, SHA256)
        'hash_md5': re.compile(r'\b[a-fA-F0-9]{32}\b'),
        'hash_sha1': re.compile(r'\b[a-fA-F0-9]{40}\b'),
        'hash_sha256': re.compile(r'\b[a-fA-F0-9]{64}\b'),
    }
    
    # Entities to skip (common false positives)
    SKIP_VALUES = {
        'ipv4': {'0.0.0.0', '127.0.0.1', '255.255.255.255', '255.255.255.0'},
        'filepath': {'/usr', '/bin', '/etc', '/var', '/tmp', '/home', '/root', '/dev', '/proc', '/sys'},
        'domain': set(),
        'port': {'0', '1', '2', '3'},
        'url': set(),
        'email': set(),
        'mac_address': {'00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff'},
        'pid': {'0', '1'},  # Skip init/kernel PIDs
        'service': set(),
        'cron': set(),
        'env_var': set(),
        'base64': set(),
        'ssh_fingerprint': set(),
        'user_agent': set(),
        'plist_key': set(),
        'command_pipeline': set(),
    }
    
    # Max entities per type per chunk (prevent explosion)
    MAX_ENTITIES_PER_TYPE = 50
    
    def __init__(self):
        """Initialize extractor."""
        pass
    
    def extract_entities(self, text: str, chunk_id: str = "") -> list[ExtractedEntity]:
        """
        Extract all entities from text.
        
        Args:
            text: The text content to analyze
            chunk_id: Optional chunk ID for logging
            
        Returns:
            List of ExtractedEntity objects (deduplicated)
        """
        entities = []
        seen = set()  # (type, normalized_value) for deduplication
        
        for entity_type, pattern in self.PATTERNS.items():
            count = 0
            skip_values = self.SKIP_VALUES.get(entity_type, set())
            
            for match in pattern.finditer(text):
                if count >= self.MAX_ENTITIES_PER_TYPE:
                    break
                
                # Handle grouped patterns (username, port, command)
                if match.groups():
                    value = next((g for g in match.groups() if g), match.group(0))
                else:
                    value = match.group(0)
                
                if not value:
                    continue
                
                # Normalize for deduplication
                normalized = self._normalize_value(entity_type, value)
                
                # Skip common false positives
                if normalized in skip_values:
                    continue
                
                # Deduplicate within this extraction
                dedup_key = (entity_type, normalized)
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)
                
                # Get context snippet (50 chars around match)
                start = max(0, match.start() - 25)
                end = min(len(text), match.end() + 25)
                context = text[start:end].replace('\n', ' ').strip()
                
                # Merge hash types into single 'hash' type
                final_type = 'hash' if entity_type.startswith('hash_') else entity_type
                
                entities.append(ExtractedEntity(
                    entity_type=final_type,
                    value=value[:500],  # Truncate very long values
                    normalized_value=normalized[:500],
                    context_snippet=context[:200],
                    start_pos=match.start(),
                    end_pos=match.end()
                ))
                count += 1
        
        return entities
    
    def _normalize_value(self, entity_type: str, value: str) -> str:
        """Normalize entity value for consistent matching."""
        if entity_type in ('ipv4', 'ipv6'):
            return value.lower()
        elif entity_type == 'domain':
            return value.lower()
        elif entity_type == 'url':
            # Normalize URL (lowercase scheme and domain, keep path case)
            return value.lower() if '?' not in value else value.split('?')[0].lower()
        elif entity_type == 'email':
            return value.lower()
        elif entity_type == 'filepath':
            # Normalize path (remove trailing slashes, lowercase)
            return value.rstrip('/').lower()
        elif entity_type == 'username':
            return value.lower()
        elif entity_type == 'command':
            # Extract just the command name
            parts = value.strip().split()
            if parts:
                cmd = parts[0].lower()
                if cmd == 'sudo' and len(parts) > 1:
                    cmd = parts[1].lower()
                return cmd
            return value.lower()
        elif entity_type == 'port':
            return value
        elif entity_type == 'mac_address':
            # Normalize to colon-separated lowercase
            return value.lower().replace('-', ':').replace('.', ':')
        elif entity_type == 'pid':
            return value
        elif entity_type == 'service':
            return value.lower()
        elif entity_type == 'cron':
            return value.strip()
        elif entity_type == 'env_var':
            return value.upper()  # Environment variables are usually uppercase
        elif entity_type == 'base64':
            return value  # Keep original case for base64
        elif entity_type == 'ssh_fingerprint':
            return value.lower()
        elif entity_type == 'user_agent':
            return value.strip().lower()
        elif entity_type == 'plist_key':
            return value.lower()
        elif entity_type == 'command_pipeline':
            return value.strip()
        elif entity_type.startswith('hash_'):
            return value.lower()
        else:
            return value.lower()
    
    def extract_entities_batch(self, chunks: list[dict]) -> dict[str, list[ExtractedEntity]]:
        """
        Extract entities from multiple chunks efficiently.
        
        Args:
            chunks: List of dicts with 'chunk_id' and 'content' keys
            
        Returns:
            Dict mapping chunk_id to list of entities
        """
        results = {}
        for chunk in chunks:
            chunk_id = chunk.get('chunk_id', '')
            content = chunk.get('content', '')
            results[chunk_id] = self.extract_entities(content, chunk_id)
        return results


# Singleton instance for reuse
_extractor = None

def get_entity_extractor() -> EntityExtractor:
    """Get the singleton entity extractor instance."""
    global _extractor
    if _extractor is None:
        _extractor = EntityExtractor()
    return _extractor
