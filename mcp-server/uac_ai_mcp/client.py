"""Async HTTP client for the UAC AI Parser backend API.

Handles authentication, token management, retries, and typed error propagation.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from uac_ai_mcp.config import Config

logger = logging.getLogger("uac_ai_mcp.client")


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class UACAPIError(Exception):
    def __init__(self, message: str, status_code: int | None = None, detail: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail


class AuthenticationError(UACAPIError):
    pass


class NotFoundError(UACAPIError):
    pass


class ValidationError(UACAPIError):
    pass


class ServerError(UACAPIError):
    pass


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class UACClient:
    """Async HTTP client wrapping the UAC AI REST API."""

    def __init__(self, config: Config) -> None:
        self._config = config
        self._base_url = config.api_url.rstrip("/")
        self._access_token: str | None = config.api_token
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=httpx.Timeout(config.http_timeout),
            follow_redirects=True,
        )

    async def close(self) -> None:
        await self._http.aclose()

    # -- auth ----------------------------------------------------------------

    @property
    def is_authenticated(self) -> bool:
        return self._access_token is not None

    async def login(self, username: str, password: str) -> dict:
        payload = {"username": username, "password": password}
        resp = await self._http.post("/auth/login", json=payload)
        data = resp.json()
        if resp.status_code >= 400:
            raise AuthenticationError(
                data.get("error", "Login failed"),
                status_code=resp.status_code,
                detail=data,
            )
        self._access_token = data.get("token")
        logger.info("Authenticated as %s", username)
        return data

    async def ensure_authenticated(self) -> None:
        if self.is_authenticated:
            return
        cfg = self._config
        if cfg.username and cfg.password:
            await self.login(cfg.username, cfg.password)
        else:
            raise AuthenticationError(
                "Not authenticated. Provide UAC_AI_USERNAME/UAC_AI_PASSWORD or UAC_AI_API_TOKEN.",
                status_code=401,
            )

    # -- HTTP methods --------------------------------------------------------

    async def get(self, path: str, params: dict | None = None) -> Any:
        return await self._request("GET", path, params=params)

    async def post(self, path: str, json: dict | None = None) -> Any:
        return await self._request("POST", path, json=json)

    async def upload(self, path: str, filepath: str, fields: dict | None = None) -> Any:
        """Upload a file using multipart/form-data."""
        import os
        await self.ensure_authenticated()
        headers: dict[str, str] = {}
        if self._access_token:
            headers["Authorization"] = f"Bearer {self._access_token}"
        filename = os.path.basename(filepath)
        with open(filepath, "rb") as f:
            files = {"file": (filename, f, "application/octet-stream")}
            data = fields or {}
            resp = await self._http.post(path, headers=headers, files=files, data=data)
        if resp.status_code >= 400:
            self._raise_for_status(resp)
        return resp.json()

    async def put(self, path: str, json: dict | None = None) -> Any:
        return await self._request("PUT", path, json=json)

    async def patch(self, path: str, json: dict | None = None) -> Any:
        return await self._request("PATCH", path, json=json)

    async def delete(self, path: str) -> Any:
        return await self._request("DELETE", path)

    # -- internal ------------------------------------------------------------

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict | None = None,
        params: dict | None = None,
        _retry: int = 0,
    ) -> Any:
        await self.ensure_authenticated()

        headers: dict[str, str] = {}
        if self._access_token:
            headers["Authorization"] = f"Bearer {self._access_token}"

        try:
            resp = await self._http.request(
                method,
                path,
                headers=headers,
                json=json,
                params=params,
            )
        except httpx.TransportError as exc:
            if _retry < self._config.http_max_retries:
                logger.warning("Network error, retrying (%d/%d): %s", _retry + 1, self._config.http_max_retries, exc)
                return await self._request(method, path, json=json, params=params, _retry=_retry + 1)
            raise UACAPIError(f"Network error: {exc}") from exc

        # Retry 5xx
        if resp.status_code >= 500 and _retry < self._config.http_max_retries:
            logger.warning("Server error %d, retrying (%d/%d)", resp.status_code, _retry + 1, self._config.http_max_retries)
            return await self._request(method, path, json=json, params=params, _retry=_retry + 1)

        if resp.status_code >= 400:
            self._raise_for_status(resp)

        if resp.status_code == 204 or not resp.content:
            return {"success": True}

        return resp.json()

    @staticmethod
    def _raise_for_status(resp: httpx.Response) -> None:
        try:
            data = resp.json()
        except Exception:
            data = {"error": resp.text or "Unknown error"}

        message = data.get("error") or data.get("message") or str(data)
        status = resp.status_code

        if status == 400:
            raise ValidationError(message, status_code=status, detail=data)
        elif status in (401, 403):
            raise AuthenticationError(message, status_code=status, detail=data)
        elif status == 404:
            raise NotFoundError(message, status_code=status, detail=data)
        elif status >= 500:
            raise ServerError(message, status_code=status, detail=data)
        else:
            raise UACAPIError(message, status_code=status, detail=data)
