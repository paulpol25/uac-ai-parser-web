"""
Export Service - Handles data export in various formats.

Supports JSONL (Timesketch), JSON, Markdown, and CSV exports.
"""
from typing import Any, Tuple
from datetime import datetime
import json


class ExportService:
    """Service for exporting analysis data."""
    
    def export(
        self,
        session_id: str,
        export_format: str,
        export_type: str = "full"
    ) -> Tuple[str, str, str]:
        """
        Export session data in the specified format.
        
        Args:
            session_id: Session identifier
            export_format: Output format (jsonl, json, markdown, csv)
            export_type: Data type to export (timeline, anomalies, full)
            
        Returns:
            Tuple of (data, content_type, filename)
        """
        # Gather data based on export type
        data = self._gather_data(session_id, export_type)
        
        # Format the output
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        if export_format == "jsonl":
            content = self._to_jsonl(data)
            content_type = "application/x-ndjson"
            filename = f"uac_export_{timestamp}.jsonl"
            
        elif export_format == "json":
            content = self._to_json(data)
            content_type = "application/json"
            filename = f"uac_export_{timestamp}.json"
            
        elif export_format == "markdown":
            content = self._to_markdown(data)
            content_type = "text/markdown"
            filename = f"uac_report_{timestamp}.md"
            
        elif export_format == "csv":
            content = self._to_csv(data)
            content_type = "text/csv"
            filename = f"uac_export_{timestamp}.csv"
            
        else:
            raise ValueError(f"Unsupported format: {export_format}")
        
        return content, content_type, filename
    
    def _gather_data(self, session_id: str, export_type: str) -> dict[str, Any]:
        """Gather data for export based on type."""
        from app.services.parser_service import ParserService
        from app.services.timeline_service import TimelineService
        
        parser = ParserService()
        artifacts = parser.get_artifacts(session_id)
        summary = parser.get_status(session_id)
        
        if artifacts is None:
            raise ValueError(f"Session {session_id} not found")
        
        data = {
            "session_id": session_id,
            "exported_at": datetime.utcnow().isoformat(),
            "summary": summary.get("summary") if summary else None,
            "artifacts": artifacts
        }
        
        if export_type in ["timeline", "full"]:
            timeline_service = TimelineService()
            try:
                timeline = timeline_service.get_timeline(session_id)
                data["timeline"] = timeline
            except Exception:
                data["timeline"] = None
        
        return data
    
    def _to_jsonl(self, data: dict) -> str:
        """Convert to JSONL format (Timesketch compatible)."""
        lines = []
        
        # Export artifacts as JSONL entries
        for artifact in data.get("artifacts", []):
            entry = {
                "datetime": datetime.utcnow().isoformat(),
                "timestamp_desc": "Artifact Collected",
                "message": f"{artifact['category']}: {artifact['name']}",
                "data_type": "uac:artifact",
                **artifact
            }
            lines.append(json.dumps(entry))
        
        # Export timeline events
        for event in data.get("timeline", {}).get("events", []):
            entry = {
                "datetime": event.get("timestamp", ""),
                "timestamp_desc": event.get("event_type", "Event"),
                "message": event.get("description", ""),
                "data_type": "uac:timeline",
                **event
            }
            lines.append(json.dumps(entry))
        
        return "\n".join(lines)
    
    def _to_json(self, data: dict) -> str:
        """Convert to pretty-printed JSON."""
        return json.dumps(data, indent=2, default=str)
    
    def _to_markdown(self, data: dict) -> str:
        """Convert to Markdown report format."""
        lines = [
            "# UAC AI Parser Analysis Report",
            "",
            f"**Session ID:** {data['session_id']}",
            f"**Exported:** {data['exported_at']}",
            "",
            "## Summary",
            ""
        ]
        
        if data.get("summary"):
            summary = data["summary"]
            lines.append(f"- **Total Artifacts:** {summary.get('total_artifacts', 'N/A')}")
            categories = summary.get("categories", {})
            for cat, count in categories.items():
                lines.append(f"  - {cat}: {count}")
        
        lines.extend([
            "",
            "## Artifacts",
            "",
            "| Category | Name | Path |",
            "|----------|------|------|"
        ])
        
        for artifact in data.get("artifacts", [])[:50]:  # Limit for readability
            lines.append(f"| {artifact['category']} | {artifact['name']} | {artifact['path']} |")
        
        if len(data.get("artifacts", [])) > 50:
            lines.append(f"| ... | *{len(data['artifacts']) - 50} more artifacts* | ... |")
        
        return "\n".join(lines)
    
    def _to_csv(self, data: dict) -> str:
        """Convert to CSV format."""
        lines = ["category,name,path,size"]
        
        for artifact in data.get("artifacts", []):
            # Escape commas in values
            name = artifact.get("name", "").replace(",", ";")
            path = artifact.get("path", "").replace(",", ";")
            lines.append(f"{artifact['category']},{name},{path},{artifact.get('size', 0)}")
        
        return "\n".join(lines)
