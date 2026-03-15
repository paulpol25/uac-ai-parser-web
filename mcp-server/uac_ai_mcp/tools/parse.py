"""File parsing / upload tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_upload_archive(
    file_path: str,
    investigation_id: int,
    investigation_name: str = "",
) -> dict:
    """Upload and parse a UAC archive (.tar.gz).

    The file at *file_path* is uploaded to the backend, which extracts,
    parses, chunks, and embeds the forensic artifacts.

    Args:
        file_path: Absolute path to the .tar.gz file on the local machine
        investigation_id: ID of the investigation to attach the session to
        investigation_name: Optional investigation name (used if creating new)
    """
    client = get_client()
    fields: dict = {"investigation_id": str(investigation_id)}
    if investigation_name:
        fields["investigation_name"] = investigation_name
    return await client.upload("/parse", file_path, fields=fields)
