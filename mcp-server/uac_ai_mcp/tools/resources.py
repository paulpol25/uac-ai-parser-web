"""MCP resources — reference data and prompts for UAC AI MCP server."""

from __future__ import annotations

from mcp.server.fastmcp import Context
from uac_ai_mcp.server import mcp


# ---------------------------------------------------------------------------
# Resources – static reference data exposed via the MCP resource protocol
# ---------------------------------------------------------------------------

@mcp.resource("uac://reference/mitre-tactics")
def mitre_tactics_reference() -> str:
    """MITRE ATT&CK tactics reference with IDs and descriptions."""
    return """\
MITRE ATT&CK Tactics (Enterprise):
- TA0001 Initial Access – Gaining initial foothold
- TA0002 Execution – Running malicious code
- TA0003 Persistence – Maintaining access
- TA0004 Privilege Escalation – Gaining higher-level permissions
- TA0005 Defense Evasion – Avoiding detection
- TA0006 Credential Access – Stealing credentials
- TA0007 Discovery – Exploring the environment
- TA0008 Lateral Movement – Moving through the network
- TA0009 Collection – Gathering data of interest
- TA0010 Exfiltration – Stealing data out
- TA0011 Command and Control – Communicating with compromised systems
- TA0040 Impact – Manipulating, interrupting, or destroying systems/data
- TA0042 Resource Development – Establishing resources to support operations
- TA0043 Reconnaissance – Gathering information to plan operations
"""


@mcp.resource("uac://reference/artifact-types")
def artifact_types_reference() -> str:
    """UAC artifact types that can be parsed and analyzed."""
    return """\
UAC Artifact Categories:
- bodyfile – Filesystem timeline in mactime bodyfile format  
- logs/auth – Authentication logs (auth.log, secure, etc.)
- logs/syslog – System logs (syslog, messages, etc.)
- logs/audit – Linux audit logs (auditd)
- logs/journal – systemd journal exports
- logs/apache – Apache/Nginx access and error logs
- logs/cron – Cron job logs
- network – Network configuration and connection state
- process – Process listings and runtime data
- user – User accounts, groups, login history
- system – System configuration, hostname, OS info
- docker – Docker container and image metadata
- packages – Installed packages and versions
- hash – File hash lists and known-good baselines
"""


@mcp.resource("uac://reference/entity-types")
def entity_types_reference() -> str:
    """Entity types extracted during analysis."""
    return """\
Entity Types (extracted by NER during parsing):
- ip_address – IPv4/IPv6 addresses
- domain – Hostnames and domain names
- email – Email addresses
- user – System usernames
- file_path – Filesystem paths
- process – Process names/PIDs
- hash – MD5, SHA1, SHA256 file hashes
- url – Full URLs
- port – Network ports
- service – Service/daemon names
- cve – CVE identifiers
- registry_key – Windows registry keys (if applicable)
"""


@mcp.resource("uac://reference/ioc-types")
def ioc_types_reference() -> str:
    """Indicator of Compromise types."""
    return """\
IOC Types:
- ip – IP addresses (C2, suspicious external IPs)
- domain – Domain names (malicious, DGA, phishing)
- url – Full URLs (download sites, C2 callbacks)
- hash – File hashes (malware samples, known-bad)
- email – Email addresses (phishing senders)
- user_agent – User-Agent strings (malware beacons)
"""


# ---------------------------------------------------------------------------
# Prompts – reusable analysis prompt templates
# ---------------------------------------------------------------------------

@mcp.prompt()
def forensic_triage(session_id: str) -> str:
    """Generate a forensic triage workflow for a session."""
    return f"""\
Perform a forensic triage on session {session_id}:

1. Get session stats with uac_get_session_stats
2. Get the session summary with uac_get_summary
3. Detect anomalies with uac_detect_anomalies
4. Extract IOCs with uac_extract_iocs
5. Run MITRE ATT&CK scan with uac_mitre_scan
6. Get timeline stats with uac_get_timeline_stats
7. Get kill chain analysis with uac_kill_chain_analysis

Synthesise findings into a triage report with:
- Executive summary
- Key findings (anomalies, IOCs, MITRE techniques)
- Timeline of significant events
- Recommended next steps
"""


@mcp.prompt()
def ioc_investigation(investigation_id: str) -> str:
    """Generate an IOC-focused investigation workflow."""
    return f"""\
Perform an IOC investigation for investigation {investigation_id}:

1. Get IOC summary with uac_ioc_summary
2. Correlate IOCs across sessions with uac_correlate_iocs
3. For each high-confidence IOC, search across sessions with uac_search_iocs
4. Check file hashes for each session
5. Get MITRE mappings to understand attack techniques

Report on:
- Unique IOCs and their prevalence across sessions
- Common indicators suggesting a coordinated attack
- Hash comparison results between sessions
- Recommended blocklist entries (IPs, domains, hashes)
"""
