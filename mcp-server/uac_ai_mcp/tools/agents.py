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
        command_type: One of run_uac, exec_command, collect_file, run_check, shutdown
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
    modules, mounts, env, hosts, history.

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
