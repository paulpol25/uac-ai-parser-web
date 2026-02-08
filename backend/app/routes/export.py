"""
Export endpoints for downloading analysis data in various formats.
"""
from flask import Blueprint, request, jsonify, Response, current_app
from datetime import datetime

from app.services.export_service import ExportService

export_bp = Blueprint("export", __name__)


SUPPORTED_FORMATS = ["jsonl", "json", "markdown", "csv"]


@export_bp.route("", methods=["GET"])
def export_data():
    """
    Export analysis data in the specified format.
    
    Query params:
        session_id: Required session identifier
        format: Export format (jsonl, json, markdown, csv)
        type: Data type to export (timeline, anomalies, full)
    """
    session_id = request.args.get("session_id")
    export_format = request.args.get("format", "json")
    export_type = request.args.get("type", "full")
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    if export_format not in SUPPORTED_FORMATS:
        return jsonify({
            "error": "invalid_format",
            "message": f"Format must be one of: {', '.join(SUPPORTED_FORMATS)}"
        }), 400
    
    export_service = ExportService()
    
    try:
        data, content_type, filename = export_service.export(
            session_id=session_id,
            export_format=export_format,
            export_type=export_type
        )
        
        return Response(
            data,
            mimetype=content_type,
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )
    except Exception as e:
        return jsonify({
            "error": "export_error",
            "message": str(e)
        }), 500


@export_bp.route("/formats", methods=["GET"])
def list_formats():
    """List available export formats."""
    return jsonify({
        "formats": [
            {"id": "jsonl", "name": "JSONL (Timesketch)", "extension": ".jsonl"},
            {"id": "json", "name": "JSON", "extension": ".json"},
            {"id": "markdown", "name": "Markdown Report", "extension": ".md"},
            {"id": "csv", "name": "CSV", "extension": ".csv"}
        ]
    })
