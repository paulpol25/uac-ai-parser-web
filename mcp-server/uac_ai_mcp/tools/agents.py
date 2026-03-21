"""Agent management MCP tools for UAC AI."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_list_agents(investigation_id: int = 0) -> dict:
    """List deployed forensic collection agents.

    Args:
        investigation_id: Filter by investigation (0 = all)
    """
    client = get_client()
    params = {}
    if investigation_id:
        params["investigation_id"] = investigation_id
    return await client.get("/agents", params=params)


@mcp.tool()
async def uac_register_agent(investigation_id: int) -> dict:
    """Register a new agent for an investigation. Returns agent_id, api_key, and bootstrap info.

    Args:
        investigation_id: Investigation to attach the agent to
    """
    client = get_client()
    return await client.post("/agents", json={"investigation_id": investigation_id})


@mcp.tool()
async def uac_get_agent(agent_id: str) -> dict:
    """Get details for a specific agent.

    Args:
        agent_id: UUID of the agent
    """
    client = get_client()
    return await client.get(f"/agents/{agent_id}")


@mcp.tool()
async def uac_delete_agent(agent_id: str) -> dict:
    """Delete an agent and all associated data.

    Args:
        agent_id: UUID of the agent to delete
    """
    client = get_client()
    return await client.delete(f"/agents/{agent_id}")


@mcp.tool()
async def uac_dispatch_command(
    agent_id: str,
    command_type: str,
    payload: dict | None = None,
) -> dict:
    """Dispatch a command to a remote agent.

    Args:
        agent_id: UUID of the target agent
        command_type: One of run_uac, exec_command, collect_file, run_check, shutdown,
            collect_logs, hash_files, persistence_check, network_capture,
            filesystem_timeline, docker_inspect, yara_scan, memory_dump
        payload: Command-specific payload (e.g. {"command": "ls -la"} for exec_command)
    """
    client = get_client()
    body: dict = {"type": command_type}
    if payload:
        body["payload"] = payload
    return await client.post(f"/agents/{agent_id}/commands", json=body)


@mcp.tool()
async def uac_list_agent_commands(agent_id: str, status: str = "") -> dict:
    """List commands dispatched to an agent.

    Args:
        agent_id: UUID of the agent
        status: Filter by status (pending, sent, completed, failed). Empty = all.
    """
    client = get_client()
    params = {}
    if status:
        params["status"] = status
    return await client.get(f"/agents/{agent_id}/commands", params=params)


@mcp.tool()
async def uac_get_command(command_id: str) -> dict:
    """Get details and result of a specific command.

    Args:
        command_id: UUID of the command
    """
    client = get_client()
    return await client.get(f"/agents/commands/{command_id}")


@mcp.tool()
async def uac_list_agent_events(agent_id: str, limit: int = 50) -> dict:
    """List audit events for an agent (heartbeats, uploads, errors).

    Args:
        agent_id: UUID of the agent
        limit: Max events to return (default 50)
    """
    client = get_client()
    return await client.get(f"/agents/{agent_id}/events", params={"limit": limit})


@mcp.tool()
async def uac_get_bootstrap_script(agent_id: str) -> dict:
    """Get the bash bootstrap script to deploy an agent on a Linux host.

    Args:
        agent_id: UUID of the agent (must be registered first)
    """
    client = get_client()
    return await client.get(f"/agents/{agent_id}/bootstrap")


@mcp.tool()
async def uac_run_triage(agent_id: str, profile: str = "ir_triage") -> dict:
    """Run a UAC triage collection on a remote agent.

    Convenience wrapper around uac_dispatch_command with type=run_uac.

    Args:
        agent_id: UUID of the target agent
        profile: UAC profile to use (default: ir_triage)
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/commands",
        json={"type": "run_uac", "payload": {"profile": profile}},
    )


@mcp.tool()
async def uac_exec_remote(agent_id: str, command: str, timeout: int = 300) -> dict:
    """Execute a shell command on a remote agent.

    Args:
        agent_id: UUID of the target agent
        command: Shell command to execute
        timeout: Max seconds to wait (default 300)
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/commands",
        json={"type": "exec_command", "payload": {"command": command, "timeout": timeout}},
    )


@mcp.tool()
async def uac_run_check(agent_id: str, check: str) -> dict:
    """Run a built-in forensic check on a remote agent.

    Available checks: processes, connections, users, crontabs, services,
    modules, mounts, env, hosts, history, login_logs, open_files,
    dns_cache, firewall, ssh_keys.

    Args:
        agent_id: UUID of the target agent
        check: Name of the check to run
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/commands",
        json={"type": "run_check", "payload": {"check": check}},
    )


@mcp.tool()
async def uac_collect_file(agent_id: str, path: str) -> dict:
    """Collect a specific file from a remote agent.

    Args:
        agent_id: UUID of the target agent
        path: Absolute path to the file on the remote host
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/commands",
        json={"type": "collect_file", "payload": {"path": path}},
    )


@mcp.tool()
async def uac_batch_commands(
    agent_id: str,
    commands: list[dict],
) -> dict:
    """Dispatch multiple commands to an agent in a single batch.

    Args:
        agent_id: UUID of the target agent
        commands: List of command objects, each with 'type' and optional 'payload'
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/commands/batch",
        json={"commands": commands},
    )


@mcp.tool()
async def uac_cancel_command(command_id: str) -> dict:
    """Cancel a pending or running command.

    Args:
        command_id: UUID of the command to cancel
    """
    client = get_client()
    return await client.post(f"/agents/commands/{command_id}/cancel")


@mcp.tool()
async def uac_run_playbook(agent_id: str, playbook: str) -> dict:
    """Run a predefined playbook on an agent.

    Available playbooks:
    - full_triage: Complete IR collection (UAC + all checks + persistence + logs)
    - quick_check: Fast overview (processes, connections, users)
    - persistence_hunt: Hunt persistence mechanisms + cron + hash system dirs
    - network_analysis: Network state, capture, DNS, firewall rules
    - malware_hunt: YARA scan + persistence + hash binaries + open files

    Args:
        agent_id: UUID of the target agent
        playbook: Name of the playbook to run
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/playbook",
        json={"playbook": playbook},
    )


@mcp.tool()
async def uac_list_playbooks() -> dict:
    """List all available predefined playbooks with their command sequences."""
    client = get_client()
    return await client.get("/agents/playbooks")


@mcp.tool()
async def uac_collect_logs(agent_id: str, pattern: str) -> dict:
    """Collect log files matching a glob pattern from a remote agent.

    Args:
        agent_id: UUID of the target agent
        pattern: Glob pattern for log files (e.g. /var/log/*.log)
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/commands",
        json={"type": "collect_logs", "payload": {"pattern": pattern}},
    )


@mcp.tool()
async def uac_hash_files(agent_id: str, path: str) -> dict:
    """Compute SHA-256 hashes for all files in a directory on a remote agent.

    Args:
        agent_id: UUID of the target agent
        path: Directory path to hash recursively
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/commands",
        json={"type": "hash_files", "payload": {"path": path}},
    )


@mcp.tool()
async def uac_persistence_check(agent_id: str) -> dict:
    """Run a comprehensive persistence mechanism check on a remote agent.

    Scans 12+ locations: crontabs, systemd units, init.d scripts, rc.local,
    bashrc/profile, authorized_keys, ld.so.preload, at jobs, kernel modules,
    setuid binaries, Docker containers.

    Args:
        agent_id: UUID of the target agent
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/commands",
        json={"type": "persistence_check"},
    )


@mcp.tool()
async def uac_network_capture(agent_id: str, duration: int = 30) -> dict:
    """Capture network traffic on a remote agent using tcpdump.

    Args:
        agent_id: UUID of the target agent
        duration: Capture duration in seconds (default 30)
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/commands",
        json={"type": "network_capture", "payload": {"duration": duration}},
    )


@mcp.tool()
async def uac_filesystem_timeline(agent_id: str, path: str = "/") -> dict:
    """Generate a MAC-time filesystem timeline from a remote agent.

    Args:
        agent_id: UUID of the target agent
        path: Root path to start from (default /)
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/commands",
        json={"type": "filesystem_timeline", "payload": {"path": path}},
    )


@mcp.tool()
async def uac_docker_inspect(agent_id: str) -> dict:
    """Inspect all Docker resources on a remote agent.

    Collects containers, images, networks, volumes, and running stats.

    Args:
        agent_id: UUID of the target agent
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/commands",
        json={"type": "docker_inspect"},
    )


@mcp.tool()
async def uac_yara_scan(agent_id: str, rules_path: str = "", scan_path: str = "/") -> dict:
    """Run a YARA scan on a remote agent.

    If rules_path is empty, the agent automatically downloads managed rules
    from the platform (uploaded rules + synced Elastic Linux rules).

    Args:
        agent_id: UUID of the target agent
        rules_path: Path to YARA rules file on the agent (empty = use managed rules)
        scan_path: Directory path to scan (default /)
    """
    client = get_client()
    payload: dict = {"scan_path": scan_path}
    if rules_path:
        payload["rules_path"] = rules_path
    return await client.post(
        f"/agents/{agent_id}/commands",
        json={"type": "yara_scan", "payload": payload},
    )


@mcp.tool()
async def uac_memory_dump(agent_id: str) -> dict:
    """Dump process memory on a remote agent (requires root).

    Uses available tools: /proc/kcore, avml, or /proc/PID/mem.

    Args:
        agent_id: UUID of the target agent
    """
    client = get_client()
    return await client.post(
        f"/agents/{agent_id}/commands",
        json={"type": "memory_dump"},
    )


# ------------------------------------------------------------------ #
#   YARA Rule Management Tools
# ------------------------------------------------------------------ #


@mcp.tool()
async def uac_list_yara_rules(source: str = "", enabled_only: bool = False) -> dict:
    """List all managed YARA rules in the platform.

    Args:
        source: Filter by source: 'upload' or 'elastic_github' (empty = all)
        enabled_only: Only return enabled rules
    """
    client = get_client()
    params: dict = {}
    if source:
        params["source"] = source
    if enabled_only:
        params["enabled"] = "true"
    return await client.get("/yara-rules", params=params)


@mcp.tool()
async def uac_upload_yara_rule(filename: str, content: str, description: str = "") -> dict:
    """Upload a YARA rule to the platform.

    The rule content should be valid YARA syntax. The filename must end in .yar or .yara.

    Args:
        filename: Rule filename (e.g. 'my_rule.yar')
        content: The YARA rule content (text)
        description: Optional description
    """
    client = get_client()
    return await client.post(
        "/yara-rules/upload",
        json={"filename": filename, "content": content, "description": description},
    )


@mcp.tool()
async def uac_delete_yara_rule(rule_id: int) -> dict:
    """Delete a YARA rule from the platform.

    Args:
        rule_id: ID of the rule to delete
    """
    client = get_client()
    return await client.delete(f"/yara-rules/{rule_id}")


@mcp.tool()
async def uac_toggle_yara_rule(rule_id: int, enabled: bool) -> dict:
    """Enable or disable a YARA rule.

    Disabled rules are not included when agents download managed rules.

    Args:
        rule_id: ID of the rule to toggle
        enabled: True to enable, False to disable
    """
    client = get_client()
    return await client.patch(f"/yara-rules/{rule_id}/toggle", json={"enabled": enabled})


@mcp.tool()
async def uac_sync_elastic_yara_rules() -> dict:
    """Sync YARA rules from Elastic's protections-artifacts GitHub repository.

    Downloads only Linux-related rules from:
    https://github.com/elastic/protections-artifacts/tree/main/yara/rules

    Returns the number of rules added, updated, and any errors.
    """
    client = get_client()
    return await client.post("/yara-rules/sync-github")
