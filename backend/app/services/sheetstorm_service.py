"""
Sheetstorm Integration Service.

Optional integration with Sheetstorm incident response platform.
Disabled when SHEETSTORM_API_URL is not configured.

Capabilities:
  • Create / update incidents
  • Add hosts and IOCs
  • Sync investigation status
"""
import logging
from typing import Any

import httpx
from flask import current_app

logger = logging.getLogger(__name__)


class SheetstormService:
    """Client for the Sheetstorm REST API."""

    def __init__(self):
        self._client: httpx.Client | None = None
        self._token: str | None = None

    # ------------------------------------------------------------------ #
    #   Lifecycle
    # ------------------------------------------------------------------ #

    @property
    def enabled(self) -> bool:
        return bool(current_app.config.get("SHEETSTORM_API_URL"))

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            base_url = current_app.config["SHEETSTORM_API_URL"].rstrip("/")
            self._client = httpx.Client(base_url=base_url, timeout=30.0)
        return self._client

    def _ensure_auth(self) -> None:
        """Authenticate if we don't have a valid token."""
        token = current_app.config.get("SHEETSTORM_API_TOKEN")
        if token:
            self._token = token
            return

        username = current_app.config.get("SHEETSTORM_USERNAME")
        password = current_app.config.get("SHEETSTORM_PASSWORD")
        if not username or not password:
            raise RuntimeError("Sheetstorm credentials not configured")

        resp = self._get_client().post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        resp.raise_for_status()
        self._token = resp.json()["token"]

    def _headers(self) -> dict:
        self._ensure_auth()
        return {"Authorization": f"Bearer {self._token}"}

    # ------------------------------------------------------------------ #
    #   Incident CRUD
    # ------------------------------------------------------------------ #

    def create_incident(
        self,
        title: str,
        description: str = "",
        severity: str = "medium",
        classification: str = "Incident",
    ) -> dict[str, Any]:
        """Create a new Sheetstorm incident."""
        resp = self._get_client().post(
            "/api/incidents",
            headers=self._headers(),
            json={
                "title": title,
                "description": description,
                "severity": severity,
                "classification": classification,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def get_incident(self, incident_id: str) -> dict[str, Any]:
        resp = self._get_client().get(
            f"/api/incidents/{incident_id}",
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def update_incident(self, incident_id: str, **fields) -> dict[str, Any]:
        resp = self._get_client().put(
            f"/api/incidents/{incident_id}",
            headers=self._headers(),
            json=fields,
        )
        resp.raise_for_status()
        return resp.json()

    def list_incidents(self, limit: int = 50) -> list[dict]:
        resp = self._get_client().get(
            "/api/incidents",
            headers=self._headers(),
            params={"limit": limit},
        )
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("incidents", [])

    # ------------------------------------------------------------------ #
    #   Host management
    # ------------------------------------------------------------------ #

    def add_host(
        self,
        incident_id: str,
        hostname: str,
        ip_address: str = "",
        os_info: str = "",
    ) -> dict[str, Any]:
        resp = self._get_client().post(
            f"/api/incidents/{incident_id}/hosts",
            headers=self._headers(),
            json={
                "hostname": hostname,
                "ip_address": ip_address,
                "os": os_info,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def list_hosts(self, incident_id: str) -> list[dict]:
        resp = self._get_client().get(
            f"/api/incidents/{incident_id}/hosts",
            headers=self._headers(),
        )
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("hosts", [])

    # ------------------------------------------------------------------ #
    #   IOC management
    # ------------------------------------------------------------------ #

    def add_ioc(
        self,
        incident_id: str,
        ioc_type: str,
        value: str,
        description: str = "",
    ) -> dict[str, Any]:
        resp = self._get_client().post(
            f"/api/incidents/{incident_id}/iocs",
            headers=self._headers(),
            json={
                "type": ioc_type,
                "value": value,
                "description": description,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def list_iocs(self, incident_id: str) -> list[dict]:
        resp = self._get_client().get(
            f"/api/incidents/{incident_id}/iocs",
            headers=self._headers(),
        )
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("iocs", [])

    # ------------------------------------------------------------------ #
    #   Convenience: sync investigation → Sheetstorm
    # ------------------------------------------------------------------ #

    def sync_investigation(self, investigation, agents: list | None = None) -> str:
        """
        Create or update a Sheetstorm incident from a UAC-AI investigation.

        Returns the Sheetstorm incident ID.
        """
        if investigation.sheetstorm_incident_id:
            # Update existing
            self.update_incident(
                investigation.sheetstorm_incident_id,
                title=investigation.name,
                description=investigation.description or "",
            )
            incident_id = investigation.sheetstorm_incident_id
        else:
            # Create new
            result = self.create_incident(
                title=investigation.name,
                description=investigation.description or "",
            )
            incident_id = str(result.get("id", result.get("incident_id", "")))
            investigation.sheetstorm_incident_id = incident_id

        # Sync agents as hosts
        if agents:
            for agent in agents:
                try:
                    self.add_host(
                        incident_id,
                        hostname=agent.hostname or "unknown",
                        ip_address=agent.ip_address or "",
                        os_info=agent.os_info or "",
                    )
                except Exception as e:
                    logger.warning("Failed to sync host %s to Sheetstorm: %s", agent.hostname, e)

        return incident_id
