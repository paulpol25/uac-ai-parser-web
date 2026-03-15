"""Chat management tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_list_chats(session_id: str) -> dict:
    """List all chats for a given session.

    Args:
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get("/chats", params={"session_id": session_id})


@mcp.tool()
async def uac_create_chat(session_id: str, title: str = "") -> dict:
    """Create a new chat thread for a session.

    Args:
        session_id: UUID of the session
        title: Optional chat title
    """
    client = get_client()
    payload: dict = {"session_id": session_id}
    if title:
        payload["title"] = title
    return await client.post("/chats", json=payload)


@mcp.tool()
async def uac_get_chat(chat_id: int) -> dict:
    """Get a chat with its messages.

    Args:
        chat_id: ID of the chat
    """
    client = get_client()
    return await client.get(f"/chats/{chat_id}")


@mcp.tool()
async def uac_update_chat(chat_id: int, title: str = "", pinned: bool | None = None) -> dict:
    """Update chat metadata (title, pinned state).

    Args:
        chat_id: ID of the chat
        title: New title (optional)
        pinned: Pin / unpin the chat (optional)
    """
    client = get_client()
    payload: dict = {}
    if title:
        payload["title"] = title
    if pinned is not None:
        payload["pinned"] = pinned
    return await client.patch(f"/chats/{chat_id}", json=payload)


@mcp.tool()
async def uac_delete_chat(chat_id: int) -> dict:
    """Delete a chat (soft-delete).

    Args:
        chat_id: ID of the chat to delete
    """
    client = get_client()
    return await client.delete(f"/chats/{chat_id}")


@mcp.tool()
async def uac_send_message(chat_id: int, content: str) -> dict:
    """Send a message to a chat and get an AI response.

    Args:
        chat_id: ID of the chat
        content: Message text to send
    """
    client = get_client()
    return await client.post(f"/chats/{chat_id}/messages", json={"content": content})


@mcp.tool()
async def uac_get_chat_messages(chat_id: int) -> dict:
    """Get all messages in a chat.

    Args:
        chat_id: ID of the chat
    """
    client = get_client()
    return await client.get(f"/chats/{chat_id}/messages")
