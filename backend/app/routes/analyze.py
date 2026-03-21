"""
Analyze endpoints for AI-powered forensic analysis with RAG.
"""
from flask import Blueprint, request, jsonify, current_app, Response
import json

from app.services.analyzer_service import AnalyzerService
from app.services.agentic_rag_service import AgenticRAGService
from app.models import Session, db
from app.routes.auth import require_auth
import logging

logger = logging.getLogger(__name__)

analyze_bp = Blueprint("analyze", __name__)


def _resolve_session_id(session_id_str: str):
    """Resolve a UUID session_id string to the integer Session.id PK."""
    session = Session.query.filter_by(session_id=session_id_str).first()
    if not session:
        return None
    return session.id


def get_analyzer() -> AnalyzerService:
    """Create analyzer service with current app config."""
    return AnalyzerService(
        ollama_url=current_app.config["OLLAMA_BASE_URL"],
        model=current_app.config["OLLAMA_MODEL"],
        chroma_persist_dir=current_app.config.get("CHROMA_PERSIST_DIR")
    )


@analyze_bp.route("/query", methods=["POST"])
@require_auth
def query():
    """
    Submit a natural language query for AI analysis.
    
    Returns Server-Sent Events for streaming response.
    """
    data = request.get_json()
    
    if not data or "session_id" not in data:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id is required"
        }), 400
    
    if "query" not in data:
        return jsonify({
            "error": "missing_query",
            "message": "query text is required"
        }), 400
    
    session_id = data["session_id"]
    query_text = data["query"]
    conversation_history = data.get("history", [])  # Support conversation history
    
    # Get app for context in generator
    app = current_app._get_current_object()
    
    def generate():
        """Generator for SSE streaming."""
        # Push app context for database access in streaming generator
        with app.app_context():
            analyzer = get_analyzer()
            full_response = ""
            try:
                for token in analyzer.query_stream(session_id, query_text, conversation_history=conversation_history):
                    full_response += token
                    yield f"event: token\ndata: {json.dumps({'text': token})}\n\n"
                
                yield f"event: done\ndata: {json.dumps({'full_response': full_response})}\n\n"
            except Exception as e:
                import traceback
                traceback.print_exc()
                error_msg = str(e)
                if "429" in error_msg or "rate" in error_msg.lower() or "quota" in error_msg.lower():
                    error_msg = "LLM rate limit exceeded. Please wait a minute and try again."
                yield f"event: error\ndata: {json.dumps({'error': error_msg})}\n\n"
    
    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )


@analyze_bp.route("/query/agent", methods=["POST"])
@require_auth
def query_agent():
    """
    Submit a query for AI analysis using agentic RAG.
    
    Agentic RAG enables multi-step investigation where the AI:
    1. Analyzes the question
    2. Searches for relevant evidence
    3. Follows leads (IPs, users, files)
    4. Builds a complete answer from findings
    
    Returns Server-Sent Events for streaming response with reasoning steps.
    """
    data = request.get_json()
    
    if not data or "session_id" not in data:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id is required"
        }), 400
    
    if "query" not in data:
        return jsonify({
            "error": "missing_query",
            "message": "query text is required"
        }), 400
    
    session_id = data["session_id"]
    query_text = data["query"]
    conversation_history = data.get("history", [])  # Get conversation history
    investigation_context = data.get("investigation_context", "")  # Get user-provided context
    
    # Get app for context in generator
    app = current_app._get_current_object()
    
    def generate():
        """Generator for SSE streaming."""
        with app.app_context():
            # Create agent service with shared RAG service
            analyzer = get_analyzer()
            agent = AgenticRAGService(rag_service=analyzer.rag_service)
            
            full_response = ""
            try:
                for chunk in agent.query_stream(
                    session_id, 
                    query_text, 
                    conversation_history=conversation_history,
                    investigation_context=investigation_context
                ):
                    full_response += chunk
                    yield f"event: token\ndata: {json.dumps({'text': chunk})}\n\n"
                
                yield f"event: done\ndata: {json.dumps({'full_response': full_response})}\n\n"
            except Exception as e:
                import traceback
                traceback.print_exc()
                error_msg = str(e)
                if "429" in error_msg or "rate" in error_msg.lower() or "quota" in error_msg.lower():
                    error_msg = "LLM rate limit exceeded. Please wait a minute and try again."
                yield f"event: error\ndata: {json.dumps({'error': error_msg})}\n\n"
    
    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )


@analyze_bp.route("/summary", methods=["GET"])
@require_auth
def get_summary():
    """Generate an incident summary for the session."""
    session_id = request.args.get("session_id")
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    analyzer = get_analyzer()
    
    try:
        summary = analyzer.generate_summary(session_id)
        return jsonify({
            "summary": summary["content"],
            "format": "markdown",
            "generated_at": summary["generated_at"]
        })
    except Exception as e:
        return jsonify({
            "error": "summary_error",
            "message": str(e)
        }), 500


@analyze_bp.route("/anomalies", methods=["GET"])
@require_auth
def detect_anomalies():
    """Detect and score anomalies in the forensic data."""
    session_id = request.args.get("session_id")
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    analyzer = get_analyzer()
    
    try:
        result = analyzer.detect_anomalies(session_id)
        return jsonify({
            "anomalies": result["anomalies"],
            "total_count": len(result["anomalies"]),
            "high_severity_count": sum(1 for a in result["anomalies"] if a["severity"] == "high")
        })
    except Exception as e:
        return jsonify({
            "error": "anomaly_error",
            "message": str(e)
        }), 500


@analyze_bp.route("/context-preview", methods=["POST"])
@require_auth
def preview_context():
    """
    Preview what context/chunks would be retrieved for a query.
    
    This helps users understand what the AI "sees" when answering questions.
    """
    data = request.get_json()
    
    if not data or "session_id" not in data:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id is required"
        }), 400
    
    if "query" not in data:
        return jsonify({
            "error": "missing_query",
            "message": "query text is required"
        }), 400
    
    session_id = data["session_id"]
    query_text = data["query"]
    top_k = data.get("top_k", 5)
    
    analyzer = get_analyzer()
    
    try:
        # Get categories that would be used
        categories = analyzer._infer_categories(query_text)
        
        # Retrieve context without generating a response
        rag_result = analyzer.rag_service.query(
            session_id=session_id,
            query_text=query_text,
            artifact_categories=categories,
            top_k=top_k
        )
        
        # Check for error in RAG result
        if "error" in rag_result and rag_result["error"]:
            return jsonify({
                "error": "rag_error",
                "message": rag_result["error"]
            }), 500
        
        # Format chunks for preview - use correct field names from RAG response
        chunks = []
        for chunk in rag_result.get("chunks", []):
            text = chunk.get("text", "")
            chunks.append({
                "text": text[:500] + ("..." if len(text) > 500 else ""),
                "source": chunk.get("source_file", "unknown"),
                "category": chunk.get("category", "unknown"),
                "score": chunk.get("relevance_score", 0),
            })
        
        return jsonify({
            "query": query_text,
            "inferred_categories": categories or ["all"],
            "chunks_retrieved": len(chunks),
            "chunks": chunks,
            "context_preview": rag_result.get("context", "")[:1000] + ("..." if len(rag_result.get("context", "")) > 1000 else ""),
            "retrieval_time_ms": rag_result.get("retrieval_time_ms", 0)
        })
    except Exception as e:
        return jsonify({
            "error": "context_error",
            "message": str(e)
        }), 500


@analyze_bp.route("/session-stats", methods=["GET"])
@require_auth
def get_session_stats():
    """Get statistics about a session's indexed data."""
    session_id = request.args.get("session_id")
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    analyzer = get_analyzer()
    
    try:
        stats = analyzer.rag_service.get_session_stats(session_id)
        return jsonify(stats)
    except Exception as e:
        return jsonify({
            "error": "stats_error",
            "message": str(e)
        }), 500


@analyze_bp.route("/extract-iocs", methods=["GET"])
@require_auth
def extract_iocs():
    """
    Extract indicators of compromise (IOCs) from forensic data.
    
    Returns structured IOC data including IPs, domains, hashes, paths, etc.
    """
    session_id = request.args.get("session_id")
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    analyzer = get_analyzer()
    
    try:
        result = analyzer.extract_iocs(session_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "error": "ioc_extraction_error",
            "message": str(e)
        }), 500

@analyze_bp.route("/entities", methods=["GET"])
@require_auth
def list_entities():
    """
    List extracted entities from a session.
    
    Query params:
    - session_id: Required session ID
    - type: Optional filter by entity type (ip, domain, username, filepath, command, timestamp, hash)
    - limit: Max entities to return (default 100)
    """
    session_id = request.args.get("session_id")
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    entity_type = request.args.get("type")
    limit = min(int(request.args.get("limit", 100)), 500)  # Cap at 500
    
    analyzer = get_analyzer()
    
    try:
        entities = analyzer.rag_service.get_session_entities(
            session_id=session_id,
            entity_type=entity_type,
            limit=limit
        )
        
        # Group by type for summary
        by_type = {}
        for e in entities:
            t = e.get("type", "unknown")
            if t not in by_type:
                by_type[t] = 0
            by_type[t] += 1
        
        return jsonify({
            "entities": entities,
            "total": len(entities),
            "by_type": by_type
        })
    except Exception as e:
        return jsonify({
            "error": "entities_error",
            "message": str(e)
        }), 500


@analyze_bp.route("/entities/search", methods=["POST"])
@require_auth
def search_entities():
    """
    Search for chunks containing a specific entity value.
    
    Body:
    - session_id: Required session ID
    - value: Entity value to search for
    - type: Optional entity type filter
    """
    data = request.get_json()
    
    if not data or "session_id" not in data:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id is required"
        }), 400
    
    if "value" not in data:
        return jsonify({
            "error": "missing_value",
            "message": "entity value to search for is required"
        }), 400
    
    session_id = data["session_id"]
    entity_value = data["value"]
    entity_type = data.get("type")
    
    analyzer = get_analyzer()
    
    try:
        results = analyzer.rag_service.search_by_entity(
            session_id=session_id,
            entity_value=entity_value,
            entity_type=entity_type
        )
        
        return jsonify({
            "query": entity_value,
            "type": entity_type,
            "results": results,
            "count": len(results)
        })
    except Exception as e:
        return jsonify({
            "error": "entity_search_error",
            "message": str(e)
        }), 500


# ========== Graph RAG Endpoints (Phase 5) ==========

@analyze_bp.route("/graph/neighbors", methods=["POST"])
@require_auth
def get_graph_neighbors():
    """
    Get entities connected to a given entity in the relationship graph.
    
    Body:
    - session_id: Required session ID
    - entity_value: Entity to find neighbors for
    - depth: Optional, how many hops to traverse (default 1, max 3)
    """
    from app.services.graph_rag_service import get_graph_rag_service
    
    data = request.get_json()
    
    if not data or "session_id" not in data:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id is required"
        }), 400
    
    if "entity_value" not in data:
        return jsonify({
            "error": "missing_entity_value",
            "message": "entity_value is required"
        }), 400
    
    session_id = data["session_id"]
    entity_value = data["entity_value"]
    depth = min(int(data.get("depth", 1)), 3)  # Cap at 3
    
    try:
        graph_service = get_graph_rag_service()
        result = graph_service.get_entity_neighbors(
            session_id=session_id,
            entity_value=entity_value,
            max_depth=depth
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "error": "graph_error",
            "message": str(e)
        }), 500


@analyze_bp.route("/graph/path", methods=["POST"])
@require_auth
def find_graph_path():
    """
    Find a path between two entities in the relationship graph.
    
    Body:
    - session_id: Required session ID
    - source: Starting entity value
    - target: Target entity value
    """
    from app.services.graph_rag_service import get_graph_rag_service
    
    data = request.get_json()
    
    if not data or "session_id" not in data:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id is required"
        }), 400
    
    if "source" not in data or "target" not in data:
        return jsonify({
            "error": "missing_entities",
            "message": "Both source and target entity values are required"
        }), 400
    
    session_id = data["session_id"]
    source = data["source"]
    target = data["target"]
    
    try:
        graph_service = get_graph_rag_service()
        result = graph_service.find_path(
            session_id=session_id,
            source_value=source,
            target_value=target
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "error": "graph_error",
            "message": str(e)
        }), 500


@analyze_bp.route("/graph/stats", methods=["GET"])
@require_auth
def get_graph_stats():
    """
    Get statistics about the entity relationship graph.
    
    Query params:
    - session_id: Required session ID
    """
    from app.services.graph_rag_service import get_graph_rag_service
    
    session_id = request.args.get("session_id")
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    try:
        graph_service = get_graph_rag_service()
        result = graph_service.get_graph_stats(session_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "error": "graph_error",
            "message": str(e)
        }), 500


@analyze_bp.route("/graph/kill-chain", methods=["GET"])
@require_auth
def get_kill_chain():
    """
    Analyze the entity graph to reconstruct potential attack stages.
    
    Query params:
    - session_id: Required session ID
    """
    from app.services.graph_rag_service import get_graph_rag_service
    
    session_id = request.args.get("session_id")
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    try:
        graph_service = get_graph_rag_service()
        result = graph_service.get_kill_chain(session_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "error": "graph_error",
            "message": str(e)
        }), 500


# ========== AI-Generated Question Suggestions ==========

# In-memory cache for suggestions (fast reload)
_suggestions_cache: dict = {}

@analyze_bp.route("/suggestions", methods=["GET"])
@require_auth
def get_suggestions():
    """
    Generate AI-powered question suggestions based on session data.
    
    Uses LLM to analyze the session's entities and categories
    to suggest relevant investigation questions.
    
    Query params:
    - session_id: Required session ID
    - refresh: Set to 'true' to regenerate (default: use cache)
    """
    session_id = request.args.get("session_id")
    refresh = request.args.get("refresh", "false").lower() == "true"
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    # Check cache first
    if not refresh and session_id in _suggestions_cache:
        return jsonify(_suggestions_cache[session_id])
    
    analyzer = get_analyzer()
    
    try:
        # Get session stats and entities for context
        stats = analyzer.rag_service.get_session_stats(session_id)
        entities = analyzer.rag_service.get_session_entities(
            session_id=session_id,
            limit=50  # Get top entities
        )
        
        # Build a quick context summary
        categories = list(stats.get("categories", {}).keys())
        
        # Group entities by type
        entity_summary = {}
        for entity in entities.get("entities", []):
            etype = entity.get("type", "other")
            if etype not in entity_summary:
                entity_summary[etype] = []
            if len(entity_summary[etype]) < 5:  # Max 5 per type
                entity_summary[etype].append(entity.get("value", ""))
        
        # Format entity summary
        entity_text = ""
        for etype, values in entity_summary.items():
            if values:
                entity_text += f"- {etype}: {', '.join(values[:3])}\n"
        
        # Create a concise prompt for fast generation
        prompt = f"""Based on this forensic data overview, generate exactly 6 specific investigation questions.

System: {stats.get('hostname', 'Unknown')} ({stats.get('os_type', 'Unknown OS')})
Data: {stats.get('total_files', 0)} files, {stats.get('total_chunks', 0)} indexed chunks
Categories: {', '.join(categories[:5]) if categories else 'general'}

Key entities found:
{entity_text if entity_text else 'No specific entities extracted yet'}

Generate 6 questions that would help investigate this system. Questions should:
- Be specific to the data available (mention actual IPs, users, paths if found)
- Cover different investigation angles (users, network, persistence, timeline)
- Be actionable and directly answerable from the data

Return ONLY the 6 questions, one per line, no numbering or bullets."""

        # Use LLM to generate suggestions (non-streaming for speed)
        import requests
        response = requests.post(
            f"{current_app.config['OLLAMA_BASE_URL']}/api/generate",
            json={
                "model": current_app.config["OLLAMA_MODEL"],
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.7,
                    "num_predict": 400,  # Keep response short
                }
            },
            timeout=30
        )
        
        if response.status_code != 200:
            raise Exception(f"LLM request failed: {response.text}")
        
        result_text = response.json().get("response", "")
        
        # Parse questions from response
        questions = []
        for line in result_text.strip().split("\n"):
            line = line.strip()
            # Remove any leading numbers, bullets, or dashes
            line = line.lstrip("0123456789.-) ").strip()
            if line and len(line) > 10 and "?" in line:
                questions.append(line)
        
        # Ensure we have at least some questions
        if len(questions) < 3:
            questions = [
                "What are the key indicators of compromise in this data?",
                "Show me any suspicious user activity or failed logins",
                "Are there any unusual network connections or processes?",
                "What persistence mechanisms might be present?",
                "Summarize the most critical security events",
                "What should I investigate further?",
            ]
        
        result = {
            "session_id": session_id,
            "questions": questions[:6],
            "generated": True,
            "context": {
                "hostname": stats.get("hostname"),
                "categories": categories[:5],
                "entity_types": list(entity_summary.keys())
            }
        }
        
        # Cache the result
        _suggestions_cache[session_id] = result
        
        return jsonify(result)
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        # Return fallback questions on error
        return jsonify({
            "session_id": session_id,
            "questions": [
                "What are the key indicators of compromise?",
                "Show failed login attempts and authentication events",
                "List any suspicious network connections",
                "What persistence mechanisms are present?",
                "Summarize critical security events from logs",
                "What files were recently modified?",
            ],
            "generated": False,
            "error": str(e)
        })


# ========== Relevance Feedback Endpoints (Phase 6) ==========

@analyze_bp.route("/relevance/stats", methods=["GET"])
@require_auth
def get_relevance_stats():
    """
    Get relevance feedback statistics for a session.
    
    Shows which chunks have been most useful in past responses.
    
    Query params:
    - session_id: Required session ID
    """
    from app.services.relevance_feedback_service import get_relevance_feedback_service
    
    session_id = request.args.get("session_id")
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    try:
        feedback_service = get_relevance_feedback_service()
        result = feedback_service.get_session_relevance_stats(session_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "error": "relevance_error",
            "message": str(e)
        }), 500


# ========== MITRE ATT&CK Endpoints ==========

@analyze_bp.route("/mitre/scan", methods=["POST"])
@require_auth
def mitre_scan():
    """
    Scan a session for MITRE ATT&CK technique indicators.
    
    Body: {"session_id": <int>}
    """
    from app.services.mitre_service import MitreService

    data = request.get_json()
    session_id = data.get("session_id") if data else None
    if not session_id:
        return jsonify({"error": "missing_session_id"}), 400

    resolved_id = _resolve_session_id(session_id)
    if resolved_id is None:
        return jsonify({"error": "session_not_found"}), 404

    try:
        svc = MitreService()
        results = svc.scan_session(resolved_id)
        return jsonify({"techniques": results, "count": len(results)})
    except Exception as e:
        return jsonify({"error": "mitre_scan_error", "message": str(e)}), 500


@analyze_bp.route("/mitre/mappings", methods=["GET"])
@require_auth
def mitre_mappings():
    """Get MITRE mappings for a session."""
    from app.services.mitre_service import MitreService

    session_id = request.args.get("session_id")
    if not session_id:
        return jsonify({"error": "missing_session_id"}), 400

    resolved_id = _resolve_session_id(session_id)
    if resolved_id is None:
        return jsonify({"error": "session_not_found"}), 404

    svc = MitreService()
    return jsonify(svc.get_session_mappings(resolved_id))


@analyze_bp.route("/mitre/summary", methods=["GET"])
@require_auth
def mitre_summary():
    """Get MITRE ATT&CK summary grouped by tactic for a session."""
    from app.services.mitre_service import MitreService

    session_id = request.args.get("session_id")
    if not session_id:
        return jsonify({"error": "missing_session_id"}), 400

    resolved_id = _resolve_session_id(session_id)
    if resolved_id is None:
        return jsonify({"error": "session_not_found"}), 404

    svc = MitreService()
    return jsonify(svc.get_session_summary(resolved_id))


# ========== IOC Endpoints ==========

@analyze_bp.route("/iocs/extract", methods=["POST"])
@require_auth
def iocs_extract():
    """
    Extract IOCs from entities for a session and correlate across investigation.
    
    Body: {"session_id": <int>}
    """
    from app.services.ioc_service import IOCService

    data = request.get_json()
    session_id = data.get("session_id") if data else None
    if not session_id:
        return jsonify({"error": "missing_session_id"}), 400

    resolved_id = _resolve_session_id(session_id)
    if resolved_id is None:
        return jsonify({"error": "session_not_found"}), 404

    svc = IOCService()
    try:
        count = svc.extract_iocs_for_session(resolved_id)
    except Exception as e:
        logger.error(f"IOC extraction failed for session {resolved_id}: {e}")
        db.session.rollback()
        db.session.remove()
        return jsonify({"error": "ioc_extraction_failed", "detail": str(e)}), 500
    return jsonify({"new_iocs": count})


@analyze_bp.route("/iocs/correlate", methods=["GET"])
@require_auth
def iocs_correlate():
    """
    Correlate IOCs across sessions in an investigation.
    
    Query params: investigation_id
    """
    from app.services.ioc_service import IOCService

    investigation_id = request.args.get("investigation_id")
    if not investigation_id:
        return jsonify({"error": "missing_investigation_id"}), 400

    svc = IOCService()
    return jsonify(svc.correlate_investigation(int(investigation_id)))


@analyze_bp.route("/iocs/summary", methods=["GET"])
@require_auth
def iocs_summary():
    """Get IOC summary for an investigation."""
    from app.services.ioc_service import IOCService

    investigation_id = request.args.get("investigation_id")
    if not investigation_id:
        return jsonify({"error": "missing_investigation_id"}), 400

    svc = IOCService()
    return jsonify(svc.get_ioc_summary(int(investigation_id)))


@analyze_bp.route("/iocs/search", methods=["POST"])
@require_auth
def iocs_search():
    """
    Search for a specific IOC value.
    
    Body: {"investigation_id": <int>, "query": "<value>", "ioc_type": "<optional>"}
    """
    from app.services.ioc_service import IOCService

    data = request.get_json()
    if not data or "investigation_id" not in data or "query" not in data:
        return jsonify({"error": "missing_fields"}), 400

    svc = IOCService()
    results = svc.search_ioc(
        int(data["investigation_id"]),
        data["query"],
        ioc_type=data.get("ioc_type"),
    )
    return jsonify(results)


# ========== Hash Endpoints ==========

@analyze_bp.route("/hashes", methods=["GET"])
@require_auth
def get_hashes():
    """
    Get file hashes for a session.
    
    Query params: session_id, unknown_only (bool)
    """
    from app.services.hash_service import HashService

    session_id = request.args.get("session_id")
    if not session_id:
        return jsonify({"error": "missing_session_id"}), 400

    resolved_id = _resolve_session_id(session_id)
    if resolved_id is None:
        return jsonify({"error": "session_not_found"}), 404

    unknown_only = request.args.get("unknown_only", "false").lower() == "true"
    svc = HashService()
    return jsonify(svc.get_session_hashes(resolved_id, unknown_only=unknown_only))


@analyze_bp.route("/hashes/compare", methods=["POST"])
@require_auth
def compare_hashes():
    """
    Compare file hashes between two sessions.
    
    Body: {"session_a": <int>, "session_b": <int>}
    """
    from app.services.hash_service import HashService

    data = request.get_json()
    if not data or "session_a" not in data or "session_b" not in data:
        return jsonify({"error": "missing_session_ids"}), 400

    svc = HashService()
    return jsonify(svc.compare_sessions(int(data["session_a"]), int(data["session_b"])))


@analyze_bp.route("/hashes/search", methods=["POST"])
@require_auth
def search_hash():
    """
    Search for a specific hash value across an investigation.
    
    Body: {"investigation_id": <int>, "hash": "<value>"}
    """
    from app.services.hash_service import HashService

    data = request.get_json()
    if not data or "investigation_id" not in data or "hash" not in data:
        return jsonify({"error": "missing_fields"}), 400

    svc = HashService()
    return jsonify(svc.search_hash(int(data["investigation_id"]), data["hash"]))


@analyze_bp.route("/hashes/mark-known-good", methods=["POST"])
@require_auth
def mark_known_good():
    """
    Mark file hashes as known-good baseline.
    
    Body: {"session_id": <int>, "file_paths": ["<path>", ...] (optional, null=all)}
    """
    from app.services.hash_service import HashService

    data = request.get_json()
    if not data or "session_id" not in data:
        return jsonify({"error": "missing_session_id"}), 400

    svc = HashService()
    count = svc.mark_known_good(int(data["session_id"]), data.get("file_paths"))
    return jsonify({"marked": count})


# ========== Session Comparison Endpoints ==========

@analyze_bp.route("/compare", methods=["POST"])
@require_auth
def compare_sessions():
    """
    Compare two sessions across all dimensions.
    
    Body: {"session_a": <int>, "session_b": <int>}
    """
    from app.services.comparison_service import ComparisonService

    data = request.get_json()
    if not data or "session_a" not in data or "session_b" not in data:
        return jsonify({"error": "missing_session_ids"}), 400

    svc = ComparisonService()
    return jsonify(svc.compare(int(data["session_a"]), int(data["session_b"])))