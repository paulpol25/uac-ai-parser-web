"""
YARA Rules Service - Manages YARA rules stored in the platform.

Supports:
  • Manual upload of .yar / .yara rule files
  • Sync from Elastic's protections-artifacts GitHub repo (Linux rules only)
  • Serving combined rules to agents for scanning
"""
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from flask import current_app

from app.models import db, YaraRule

logger = logging.getLogger(__name__)

# GitHub API endpoint for Elastic's YARA rules directory
_ELASTIC_API_URL = (
    "https://api.github.com/repos/elastic/protections-artifacts"
    "/contents/yara/rules"
)

# Only sync rules whose filename contains "Linux" (case-insensitive)
_LINUX_FILTER = re.compile(r"linux", re.IGNORECASE)


class YaraRuleService:
    """Service for managing YARA rules."""

    # ------------------------------------------------------------------ #
    #   CRUD
    # ------------------------------------------------------------------ #

    def list_rules(self, source: str | None = None, enabled_only: bool = False) -> list[dict[str, Any]]:
        query = YaraRule.query
        if source:
            query = query.filter_by(source=source)
        if enabled_only:
            query = query.filter_by(enabled=True)
        return [r.to_dict() for r in query.order_by(YaraRule.name).all()]

    def get_rule(self, rule_id: int) -> YaraRule | None:
        return db.session.get(YaraRule, rule_id)

    def get_rule_content(self, rule_id: int) -> str | None:
        rule = db.session.get(YaraRule, rule_id)
        return rule.content if rule else None

    def upload_rule(self, filename: str, content: str, description: str = "") -> dict[str, Any]:
        """Upload a single YARA rule file."""
        if not filename.endswith((".yar", ".yara")):
            raise ValueError("Only .yar / .yara files are accepted")

        name = Path(filename).stem

        existing = YaraRule.query.filter_by(filename=filename).first()
        if existing:
            existing.content = content
            existing.file_size = len(content.encode())
            existing.description = description or existing.description
            existing.updated_at = datetime.utcnow()
            db.session.commit()
            return existing.to_dict()

        rule = YaraRule(
            name=name,
            filename=filename,
            description=description,
            source="upload",
            content=content,
            file_size=len(content.encode()),
        )
        db.session.add(rule)
        db.session.commit()
        return rule.to_dict()

    def delete_rule(self, rule_id: int) -> bool:
        rule = db.session.get(YaraRule, rule_id)
        if not rule:
            return False
        db.session.delete(rule)
        db.session.commit()
        return True

    def toggle_rule(self, rule_id: int, enabled: bool) -> dict[str, Any] | None:
        rule = db.session.get(YaraRule, rule_id)
        if not rule:
            return None
        rule.enabled = enabled
        rule.updated_at = datetime.utcnow()
        db.session.commit()
        return rule.to_dict()

    def batch_toggle(self, enabled: bool, source: str | None = None) -> int:
        """Enable or disable all rules (optionally filtered by source). Returns count updated."""
        query = YaraRule.query
        if source:
            query = query.filter_by(source=source)
        rules = query.all()
        now = datetime.utcnow()
        for r in rules:
            r.enabled = enabled
            r.updated_at = now
        db.session.commit()
        return len(rules)

    # ------------------------------------------------------------------ #
    #   Combined rules for agent download
    # ------------------------------------------------------------------ #

    def get_combined_rules(self) -> str:
        """Return all enabled rules concatenated as a single .yar file."""
        rules = YaraRule.query.filter_by(enabled=True).order_by(YaraRule.name).all()
        parts = []
        for r in rules:
            parts.append(f"// --- {r.filename} ({r.source}) ---")
            parts.append(r.content)
            parts.append("")
        return "\n".join(parts)

    # ------------------------------------------------------------------ #
    #   GitHub sync (Elastic protections-artifacts – Linux rules only)
    # ------------------------------------------------------------------ #

    def sync_elastic_github(self) -> dict[str, Any]:
        """
        Fetch YARA rules from Elastic's protections-artifacts repo.

        Only downloads files whose name contains 'Linux'.
        Updates existing rules (by filename) and adds new ones.
        """
        headers = {"Accept": "application/vnd.github.v3+json"}
        # Use a GitHub token if configured for higher rate limits
        gh_token = current_app.config.get("GITHUB_TOKEN", "")
        if gh_token:
            headers["Authorization"] = f"token {gh_token}"

        try:
            resp = requests.get(_ELASTIC_API_URL, headers=headers, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as exc:
            logger.error("Failed to list Elastic YARA rules: %s", exc)
            raise RuntimeError(f"GitHub API error: {exc}") from exc

        entries = resp.json()
        if not isinstance(entries, list):
            raise RuntimeError("Unexpected GitHub API response (not a list)")

        # Filter for Linux-related .yar files
        linux_files = [
            e for e in entries
            if e.get("type") == "file"
            and e.get("name", "").endswith((".yar", ".yara"))
            and _LINUX_FILTER.search(e.get("name", ""))
        ]

        added = 0
        updated = 0
        errors = []

        for entry in linux_files:
            filename = entry["name"]
            download_url = entry.get("download_url", "")
            if not download_url:
                errors.append(f"{filename}: no download URL")
                continue

            try:
                file_resp = requests.get(download_url, headers=headers, timeout=30)
                file_resp.raise_for_status()
                content = file_resp.text
            except requests.RequestException as exc:
                errors.append(f"{filename}: download failed ({exc})")
                continue

            existing = YaraRule.query.filter_by(filename=filename).first()
            if existing:
                if existing.content != content:
                    existing.content = content
                    existing.file_size = len(content.encode())
                    existing.updated_at = datetime.utcnow()
                    updated += 1
            else:
                rule = YaraRule(
                    name=Path(filename).stem,
                    filename=filename,
                    description=f"Auto-synced from Elastic protections-artifacts",
                    source="elastic_github",
                    content=content,
                    file_size=len(content.encode()),
                )
                db.session.add(rule)
                added += 1

        db.session.commit()
        logger.info("Elastic YARA sync: %d added, %d updated, %d errors", added, updated, len(errors))
        return {
            "total_linux_rules": len(linux_files),
            "added": added,
            "updated": updated,
            "errors": errors,
        }
