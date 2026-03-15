"""
Timeline endpoints for generating and retrieving forensic timelines.
"""
from flask import Blueprint, request, jsonify, current_app

from app.services.timeline_service import TimelineService

timeline_bp = Blueprint("timeline", __name__)


@timeline_bp.route("", methods=["GET"])
def get_timeline():
    """
    Get timeline data using internal parser.
    
    Query params:
        session_id: Required session identifier
        start: Optional ISO timestamp for range start
        end: Optional ISO timestamp for range end
        event_types: Optional comma-separated event types to filter
    """
    session_id = request.args.get("session_id")
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    # Optional filters
    start_time = request.args.get("start")
    end_time = request.args.get("end")
    event_types = request.args.get("event_types", "").split(",") if request.args.get("event_types") else None
    
    timeline_service = TimelineService()
    
    try:
        result = timeline_service.get_timeline(
            session_id=session_id,
            start_time=start_time,
            end_time=end_time,
            event_types=event_types
        )
        
        return jsonify({
            "events": result["events"],
            "total_events": result["total_events"],
            "time_range": result["time_range"]
        })
    except Exception as e:
        return jsonify({
            "error": "timeline_error",
            "message": str(e)
        }), 500


@timeline_bp.route("/plaso", methods=["POST"])
def trigger_plaso():
    """
    Trigger Plaso timeline generation (requires Docker).
    
    Returns a job ID for status checking.
    """
    data = request.get_json()
    
    if not data or "session_id" not in data:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id is required"
        }), 400
    
    timeline_service = TimelineService()
    
    # Check Docker availability
    if not timeline_service.is_plaso_available():
        return jsonify({
            "error": "plaso_unavailable",
            "message": "Docker is not available. Plaso integration requires Docker."
        }), 503
    
    try:
        job = timeline_service.start_plaso_job(data["session_id"])
        return jsonify({
            "job_id": job["job_id"],
            "status": "queued",
            "message": "Plaso timeline generation started"
        }), 202
    except Exception as e:
        return jsonify({
            "error": "plaso_error",
            "message": str(e)
        }), 500


@timeline_bp.route("/plaso/status", methods=["GET"])
def get_plaso_status():
    """Check Plaso job status."""
    job_id = request.args.get("job_id")
    
    if not job_id:
        return jsonify({
            "error": "missing_job_id",
            "message": "job_id query parameter is required"
        }), 400
    
    timeline_service = TimelineService()
    status = timeline_service.get_plaso_job_status(job_id)
    
    if status is None:
        return jsonify({
            "error": "not_found",
            "message": f"Job {job_id} not found"
        }), 404
    
    return jsonify(status)


@timeline_bp.route("/stats", methods=["GET"])
def get_timeline_stats():
    """
    Get timeline statistics: event frequency by hour/day, event type distribution.
    
    Query params: session_id
    """
    session_id = request.args.get("session_id")
    if not session_id:
        return jsonify({"error": "missing_session_id"}), 400

    timeline_service = TimelineService()
    try:
        return jsonify(timeline_service.get_timeline_stats(session_id))
    except Exception as e:
        return jsonify({"error": "stats_error", "message": str(e)}), 500


@timeline_bp.route("/correlate", methods=["GET"])
def correlate_events():
    """
    Correlate events within time windows for attack chain detection.
    
    Query params: session_id, window (seconds, default 60)
    """
    session_id = request.args.get("session_id")
    if not session_id:
        return jsonify({"error": "missing_session_id"}), 400

    window = int(request.args.get("window", 60))
    timeline_service = TimelineService()
    try:
        clusters = timeline_service.correlate_events(session_id, window_seconds=window)
        return jsonify({"clusters": clusters, "count": len(clusters)})
    except Exception as e:
        return jsonify({"error": "correlate_error", "message": str(e)}), 500
