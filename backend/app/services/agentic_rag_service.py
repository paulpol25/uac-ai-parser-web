"""
Agentic RAG Service - LLM-driven iterative search and reasoning.

Instead of a single retrieval + generation pass, the agent:
1. Analyzes the user question
2. Decides what to search for
3. Retrieves relevant chunks
4. Analyzes results and decides:
   - Search for more information
   - Provide final answer

This enables multi-hop reasoning like:
"Was there unauthorized access?" 
→ Check auth logs 
→ Found failed logins from IP X
→ Search what IP X did
→ Found wget command
→ Search what was downloaded
→ Final answer with full chain

Privacy note: All reasoning happens via the configured LLM provider.
- Ollama: Fully local, no data leaves your machine
- Cloud providers: Data sent to their APIs (with privacy warnings)
"""
from typing import Generator, Any, Dict
from datetime import datetime, timedelta
import json
import re
import time

from app.services.tiered_rag_service import TieredRAGService
from app.services.llm_providers import get_provider


class QueryCache:
    """Simple in-memory cache with TTL for query results."""
    
    def __init__(self, ttl_seconds: int = 300):
        self._cache: Dict[str, tuple] = {}  # key -> (value, timestamp)
        self._ttl = timedelta(seconds=ttl_seconds)
    
    def get(self, key: str) -> Any:
        """Get cached value if not expired."""
        if key in self._cache:
            value, timestamp = self._cache[key]
            if datetime.now() - timestamp < self._ttl:
                return value
            else:
                del self._cache[key]
        return None
    
    def set(self, key: str, value: Any) -> None:
        """Cache a value."""
        self._cache[key] = (value, datetime.now())
    
    def clear(self, session_id: str = None) -> None:
        """Clear cache, optionally for a specific session."""
        if session_id:
            keys_to_delete = [k for k in self._cache if k.startswith(f"{session_id}:")]
            for k in keys_to_delete:
                del self._cache[k]
        else:
            self._cache.clear()


# Global cache for entity lists and traversal results
_query_cache = QueryCache(ttl_seconds=300)  # 5 minute TTL


class AgenticRAGService:
    """
    Agentic RAG with LLM-driven tool use for forensic investigation.
    
    The agent has access to tools:
    - search_chunks: General semantic/keyword search
    - search_entity: Search by specific entity (IP, user, file, etc.)
    - list_entities: Get entities found in the session
    - final_answer: Provide the final response
    """
    
    # Maximum iterations to prevent infinite loops
    MAX_ITERATIONS = 5
    
    # Tool definitions for the agent
    TOOLS = [
        {
            "name": "search_chunks",
            "description": "Search for relevant text chunks using semantic and keyword matching. Good for general queries and concepts.",
            "parameters": {
                "query": "The search query - can be keywords, phrases, or natural language",
                "source_filter": "Optional: filter by source file path contains (e.g., 'bash_history', 'auth.log', 'cron')"
            }
        },
        {
            "name": "search_exact",
            "description": "Search for exact text matches in chunks. BEST for finding specific commands, IPs, file paths, or any known string. Use this when looking for 'wget', 'curl', specific IPs, or command syntax.",
            "parameters": {
                "text": "The exact text to find (e.g., 'wget', 'curl', '192.168.1.100', '/tmp/backdoor')",
                "source_filter": "Optional: filter by source file path contains (e.g., 'bash_history', 'auth.log')"
            }
        },
        {
            "name": "search_entity",
            "description": "Search for chunks containing a specific extracted entity like an IP address, username, file path, or command. More precise than search_chunks for known entity values.",
            "parameters": {
                "entity_value": "The entity to search for (e.g., '192.168.1.100', 'john', '/tmp/backdoor.sh')",
                "entity_type": "Optional: ip, username, filepath, command, domain, hash (helps narrow results)"
            }
        },
        {
            "name": "list_entities",
            "description": "List extracted entities from the forensic artifacts. Useful to discover IPs, usernames, suspicious files, or commands present in the data.",
            "parameters": {
                "entity_type": "Optional filter: ip, username, filepath, command, domain, timestamp, hash"
            }
        },
        {
            "name": "traverse_graph",
            "description": "Explore relationships from an entity. Shows what the entity is connected to (e.g., what user executed which commands, what IP connected to what). ESSENTIAL for following attack chains and understanding context.",
            "parameters": {
                "entity_value": "Starting entity to traverse from (e.g., 'john', '192.168.1.100', 'wget')",
                "depth": "How many hops to follow (1=direct connections, 2=connections of connections). Default 1."
            }
        },
        {
            "name": "find_path",
            "description": "Find how two entities are connected in the relationship graph. Use this to understand the connection between an attacker IP and a compromised file, or user and suspicious activity.",
            "parameters": {
                "source_entity": "Starting entity (e.g., '192.168.1.100')",
                "target_entity": "Target entity (e.g., '/tmp/backdoor.sh')"
            }
        },
        {
            "name": "get_kill_chain",
            "description": "Analyze the entity graph to reconstruct potential attack stages: initial access, execution, persistence, privilege escalation, data access, exfiltration. Useful for attack summary.",
            "parameters": {}
        },
        {
            "name": "search_iocs",
            "description": "Search specifically for Indicators of Compromise (IOCs). Finds all IPs, domains, URLs, or hashes matching your pattern. Use when investigating specific threat indicators.",
            "parameters": {
                "ioc_type": "Type of IOC: 'ip' (IPv4/IPv6), 'domain', 'url', 'hash' (MD5/SHA1/SHA256), or 'all'",
                "pattern": "Optional: specific pattern to match (e.g., '61.54' for IPs starting with that, 'malware' for domains containing it)"
            }
        },
        {
            "name": "get_temporal_context",
            "description": "Get events that occurred before and after a specific time or near a specific log entry. Useful for understanding what happened around a suspicious event.",
            "parameters": {
                "reference_text": "Text from a log entry to find temporal context around",
                "window_minutes": "Time window in minutes before/after (default 5)"
            }
        },
        {
            "name": "search_similar_commands",
            "description": "Find all commands using a specific binary/tool. Can search for one binary (e.g., 'wget') or multiple (e.g., 'wget, curl'). BEST for discovering command execution history.",
            "parameters": {
                "binary_name": "The command/binary to search for. Examples: 'wget', 'curl', 'ssh', 'nc'. Can include multiple: 'wget, curl'"
            }
        },
        {
            "name": "find_related_commands",
            "description": "Find other commands related to a specific command or entity. Searches for commands executed by the same user, from the same IP, or in a similar time window. POWERFUL for discovering attack chains.",
            "parameters": {
                "reference_command": "A command string or entity value to find related commands for",
                "relation_type": "How to find related commands: 'same_user' (same user executed), 'same_ip' (same source IP), 'same_source' (same source file), or 'all' (try all)"
            }
        },
        {
            "name": "get_attack_timeline",
            "description": "Build a chronological timeline of all activity involving a specific entity (IP, user, command). Shows events in order to understand the attack sequence.",
            "parameters": {
                "entity_value": "The entity to build timeline for (e.g., IP address, username, or part of a command)",
                "limit": "Maximum number of events to return (default 20)"
            }
        },
        {
            "name": "save_finding",
            "description": "Save an important finding during investigation. Use this to note critical discoveries like confirmed malicious activity, compromised accounts, or attack indicators. Findings are included in the final summary.",
            "parameters": {
                "finding": "Description of the finding",
                "severity": "high, medium, or low",
                "evidence": "Supporting evidence (command, log entry, etc.)"
            }
        },
        {
            "name": "extract_from_text",
            "description": "Extract IPs, domains, URLs, commands, and other entities from any text. USE THIS when the user asks about 'the IPs above', 'those commands', etc. - pass in your previous response to extract the specific values.",
            "parameters": {
                "text": "The text to extract entities from (e.g., your previous response or a log snippet)",
                "entity_type": "Optional: filter to specific type - 'ip', 'domain', 'url', 'command', 'hash', or 'all' (default)"
            }
        },
        {
            "name": "final_answer",
            "description": "Provide the final answer to the user's question. Only call this when you have enough information to fully answer.",
            "parameters": {
                "answer": "Your complete answer to the user's question, including relevant findings and evidence."
            }
        }
    ]
    
    def __init__(self, rag_service: TieredRAGService = None):
        """
        Initialize the agentic RAG service.
        
        Args:
            rag_service: TieredRAGService instance (shared with main analyzer)
        """
        self.rag_service = rag_service or TieredRAGService()
        self._provider = None
    
    @property
    def provider(self):
        """Get current LLM provider (lazy loaded)."""
        if self._provider is None:
            self._provider = get_provider()
        return self._provider
    
    def _build_agent_prompt(self, query: str, session_context: str, 
                            history: list[dict] = None) -> str:
        """
        Build the agent system prompt with tool definitions.
        """
        tools_desc = "\n".join([
            f"- {t['name']}: {t['description']}\n  Parameters: {json.dumps(t['parameters'])}"
            for t in self.TOOLS
        ])
        
        history_text = ""
        if history:
            history_text = "\n\nPrevious steps in this investigation:\n"
            for step in history:
                history_text += f"\nAction: {step.get('action', 'unknown')}"
                if step.get('params'):
                    history_text += f"\nParameters: {json.dumps(step['params'])}"
                if step.get('result_summary'):
                    history_text += f"\nResult: {step['result_summary']}"
                history_text += "\n---"
        
        return f'''You are a forensic investigator AI assistant analyzing Linux system artifacts from UAC (Unix-like Artifacts Collector).

You have access to the following tools to investigate:

{tools_desc}

TOOL SELECTION GUIDE:
- search_exact: Use for finding specific commands (wget, curl, ssh), IPs, file paths, or known strings. ALWAYS try this first for command-related questions.
- search_similar_commands: BEST for finding ALL instances of a command type (e.g., all wget, all curl). Use this when user asks about a type of command.
- find_related_commands: POWERFUL - After finding a command, use this to find other commands by same user/IP/source. Great for discovering full attack chains.
- get_attack_timeline: Build a chronological timeline of all activity involving an entity. Shows attack sequence.
- search_iocs: Use for finding IOCs (IPs, domains, hashes). Great for threat hunting.
- search_chunks: Use for general/semantic queries about concepts, activities, or when exact searches return nothing.
- search_entity: Use when you know a specific entity value (IP, username, path) to find related chunks.
- list_entities: Use to discover what IPs, users, commands, etc. exist in the data.
- traverse_graph: CRITICAL - After finding any entity, USE THIS to see its connections. Shows attack chains.
- get_temporal_context: Use to see what happened before/after a suspicious event.
- get_kill_chain: Use to get an attack summary across all entities.
- save_finding: Save critical discoveries (malicious IPs, compromised accounts, attack patterns) for the summary.
- extract_from_text: Extract IPs, domains, URLs from any text. USE THIS for follow-up questions about "the IPs" or "those commands" - pass your previous response.

MANDATORY WORKFLOW (follow this sequence):
1. FIRST: Use search_similar_commands or search_exact to find what the user asked about
2. THEN: Extract key entities from results (IPs, usernames, commands, paths)
3. MUST DO: Use traverse_graph OR find_related_commands to discover connections
4. OPTIONALLY: Use get_attack_timeline to understand the sequence
5. SAVE important findings using save_finding before providing final_answer

EXAMPLE INVESTIGATION:
- User asks: "find wget commands"
- Step 1: search_similar_commands(binary_name='wget') → finds 3 wget commands with IP 61.54.199.59
- Step 2: traverse_graph(entity_value='61.54.199.59') → shows IP also connected to nc, curl commands
- Step 3: save_finding(finding='Malicious IP 61.54.199.59 used for multiple downloads', severity='high')
- Step 4: final_answer with full context

IMPORTANT RULES:
1. For questions about specific commands (wget, curl, sudo, etc.), USE search_similar_commands FIRST
2. ALWAYS call traverse_graph OR find_related_commands after finding commands or IPs - this reveals related activity
3. When you find an interesting entity, explore its connections before answering
4. Save critical findings using save_finding - especially high severity ones
5. Think step by step about what information you need
6. Be thorough - follow leads and connections between entities  
7. Maximum {self.MAX_ITERATIONS} tool calls allowed

FOLLOW-UP QUESTIONS:
When user asks about "the IPs", "those commands", "the output above", etc.:
1. LOOK at your previous ASSISTANT response in the conversation history
2. USE extract_from_text tool on your previous response to get the exact IPs, domains, etc.
3. SEARCH for those extracted values using search_exact or traverse_graph
4. Do NOT say "no results found" if you can see values in your previous response - extract and search for them!

Session context:
{session_context}
{history_text}

User question: {query}

Think about what you need to find, then call a tool. Output your reasoning, then call exactly ONE tool.

Format your response as:
THINKING: [Your reasoning about what to search for and why]
TOOL: [tool_name]
PARAMS: {{"param1": "value1", "param2": "value2"}}

Or if you have enough information:
THINKING: [Summary of what you found]
TOOL: final_answer
PARAMS: {{"answer": "Your complete answer here"}}
'''
    
    def _parse_agent_response(self, response: str) -> dict:
        """
        Parse the agent's response to extract tool call.
        
        Returns:
            Dict with 'thinking', 'tool', 'params' keys
        """
        result = {
            "thinking": "",
            "tool": None,
            "params": {}
        }
        
        # Extract thinking
        thinking_match = re.search(r'THINKING:\s*(.+?)(?=TOOL:|$)', response, re.DOTALL)
        if thinking_match:
            result["thinking"] = thinking_match.group(1).strip()
        
        # Extract tool name
        tool_match = re.search(r'TOOL:\s*(\w+)', response)
        if tool_match:
            result["tool"] = tool_match.group(1).strip()
        
        # Extract params (JSON)
        params_match = re.search(r'PARAMS:\s*(\{.+?\})', response, re.DOTALL)
        if params_match:
            try:
                result["params"] = json.loads(params_match.group(1))
            except json.JSONDecodeError:
                # Try to fix common issues
                params_str = params_match.group(1)
                # Replace single quotes with double quotes
                params_str = params_str.replace("'", '"')
                try:
                    result["params"] = json.loads(params_str)
                except:
                    pass
        
        return result
    
    def _execute_tool(self, session_id: str, tool_name: str, params: dict) -> dict:
        """
        Execute a tool and return results.
        
        Returns:
            Dict with 'success', 'result', 'summary' keys
        """
        try:
            if tool_name == "search_chunks":
                query = params.get("query", "")
                source_filter = params.get("source_filter")
                
                result = self.rag_service.query(
                    session_id=session_id,
                    query_text=query,
                    top_k=10,  # Get more to filter
                    use_reranking=True,
                    include_context_window=False
                )
                
                chunks = result.get("chunks", [])
                
                # Apply source filter if specified
                if source_filter and chunks:
                    chunks = [c for c in chunks if source_filter.lower() in c.get("source_file", "").lower()]
                
                if not chunks:
                    filter_note = f" (filtered by '{source_filter}')" if source_filter else ""
                    return {
                        "success": True,
                        "result": [],
                        "summary": f"No results found for query: {query}{filter_note}"
                    }
                
                # Format chunks for agent
                formatted = []
                for c in chunks[:5]:
                    formatted.append({
                        "source": c.get("source_file", "unknown"),
                        "text": c.get("text", "")[:500],  # Truncate for context window
                        "score": round(c.get("relevance_score", 0), 3)
                    })
                
                return {
                    "success": True,
                    "result": formatted,
                    "summary": f"Found {len(chunks)} chunks for '{query}'. Top sources: {', '.join(set(c['source'] for c in formatted[:3]))}"
                }
            
            elif tool_name == "search_exact":
                # Direct substring search in chunk content - best for exact command matches
                from app.models import Chunk, Session
                
                text = params.get("text", "")
                source_filter = params.get("source_filter")
                
                session = Session.query.filter_by(session_id=session_id).first()
                if not session:
                    return {"success": False, "result": [], "summary": "Session not found"}
                
                # Build query for substring match
                query = Chunk.query.filter(
                    Chunk.session_id == session.id,
                    Chunk.content.ilike(f'%{text}%')
                )
                
                # Apply source filter
                if source_filter:
                    query = query.filter(Chunk.source_file.ilike(f'%{source_filter}%'))
                
                # Order by importance and limit
                matches = query.order_by(Chunk.importance_score.desc()).limit(10).all()
                
                if not matches:
                    filter_note = f" in files containing '{source_filter}'" if source_filter else ""
                    return {
                        "success": True,
                        "result": [],
                        "summary": f"No exact matches for '{text}'{filter_note}"
                    }
                
                # Format results - include more context for exact matches
                formatted = []
                for chunk in matches:
                    # Highlight the matching text in context
                    content = chunk.content
                    # Find the text and extract surrounding context
                    text_lower = text.lower()
                    content_lower = content.lower()
                    idx = content_lower.find(text_lower)
                    if idx >= 0:
                        start = max(0, idx - 100)
                        end = min(len(content), idx + len(text) + 200)
                        snippet = content[start:end]
                        if start > 0:
                            snippet = "..." + snippet
                        if end < len(content):
                            snippet = snippet + "..."
                    else:
                        snippet = content[:400]
                    
                    formatted.append({
                        "source": chunk.source_file,
                        "text": snippet,
                        "full_match": True
                    })
                
                # Extract IPs from results for suggestion
                import re as regex
                ip_pattern = r'\b(?:\d{1,3}\.){3}\d{1,3}\b'
                found_ips = set()
                for f in formatted:
                    ips = regex.findall(ip_pattern, f.get('text', ''))
                    found_ips.update(ips)
                
                # Build summary with suggestion
                summary = f"Found {len(matches)} exact matches for '{text}'. Sources: {', '.join(set(c['source'] for c in formatted[:5]))}"
                if found_ips:
                    summary += f". TIP: Use traverse_graph on '{list(found_ips)[0]}' to see related activity."
                
                return {
                    "success": True,
                    "result": formatted,
                    "summary": summary
                }
            
            elif tool_name == "search_entity":
                entity_value = params.get("entity_value", "")
                entity_type = params.get("entity_type")
                
                results = self.rag_service.search_by_entity(
                    session_id=session_id,
                    entity_value=entity_value,
                    entity_type=entity_type
                )
                
                if not results:
                    return {
                        "success": True,
                        "result": [],
                        "summary": f"No results found for entity: {entity_value}"
                    }
                
                # Format results
                formatted = []
                for r in results[:5]:
                    formatted.append({
                        "source": r.get("source_file", "unknown"),
                        "text": r.get("content", "")[:500],
                        "entity_type": r.get("entity_type"),
                        "context": r.get("context_snippet", "")
                    })
                
                return {
                    "success": True,
                    "result": formatted,
                    "summary": f"Found {len(results)} results for entity '{entity_value}'. Sources: {', '.join(set(r['source'] for r in formatted[:3]))}"
                }
            
            elif tool_name == "list_entities":
                entity_type = params.get("entity_type")
                
                # Check cache first
                cache_key = f"{session_id}:list_entities:{entity_type or 'all'}"
                cached = _query_cache.get(cache_key)
                if cached is not None:
                    return cached
                
                entities = self.rag_service.get_session_entities(
                    session_id=session_id,
                    entity_type=entity_type,
                    limit=20
                )
                
                if not entities:
                    type_str = f" of type '{entity_type}'" if entity_type else ""
                    result = {
                        "success": True,
                        "result": [],
                        "summary": f"No entities{type_str} found in session"
                    }
                    _query_cache.set(cache_key, result)
                    return result
                
                # Group by type for summary
                by_type = {}
                for e in entities:
                    t = e.get("type", "unknown")
                    if t not in by_type:
                        by_type[t] = []
                    by_type[t].append(e.get("value", ""))
                
                summary_parts = []
                for t, values in by_type.items():
                    summary_parts.append(f"{t}: {', '.join(values[:5])}")
                
                result = {
                    "success": True,
                    "result": entities,
                    "summary": f"Found entities: {'; '.join(summary_parts)}"
                }
                _query_cache.set(cache_key, result)
                return result
            
            elif tool_name == "final_answer":
                answer = params.get("answer", "I could not find enough information to answer.")
                return {
                    "success": True,
                    "result": answer,
                    "summary": "Final answer provided",
                    "is_final": True
                }
            
            elif tool_name == "traverse_graph":
                from app.services.graph_rag_service import get_graph_rag_service
                
                entity_value = params.get("entity_value", "")
                depth = int(params.get("depth", 1))
                depth = min(depth, 3)  # Cap at 3 to prevent explosion
                
                # Check cache for expensive graph traversal
                cache_key = f"{session_id}:traverse_graph:{entity_value}:{depth}"
                cached = _query_cache.get(cache_key)
                if cached is not None:
                    return cached
                
                graph_service = get_graph_rag_service()
                result = graph_service.get_entity_neighbors(
                    session_id=session_id,
                    entity_value=entity_value,
                    max_depth=depth
                )
                
                if result.get("error"):
                    return_val = {
                        "success": True,
                        "result": result,
                        "summary": f"Entity '{entity_value}' not found in graph"
                    }
                    return return_val
                
                # Build summary
                neighbors = result.get("neighbors", [])
                if not neighbors:
                    return_val = {
                        "success": True,
                        "result": result,
                        "summary": f"Entity '{entity_value}' has no relationships"
                    }
                    _query_cache.set(cache_key, return_val)
                    return return_val
                
                # Group by relationship for summary
                by_rel = result.get("by_relationship", {})
                rel_summaries = []
                for rel_type, items in list(by_rel.items())[:5]:
                    entities = [i["entity_value"] for i in items[:3]]
                    rel_summaries.append(f"{rel_type}: {', '.join(entities[:3])}")
                
                return_val = {
                    "success": True,
                    "result": result,
                    "summary": f"'{entity_value}' connected to {len(neighbors)} entities. {'; '.join(rel_summaries)}"
                }
                _query_cache.set(cache_key, return_val)
                return return_val
            
            elif tool_name == "find_path":
                from app.services.graph_rag_service import get_graph_rag_service
                
                source = params.get("source_entity", "")
                target = params.get("target_entity", "")
                
                graph_service = get_graph_rag_service()
                result = graph_service.find_path(
                    session_id=session_id,
                    source_value=source,
                    target_value=target,
                    max_depth=5
                )
                
                if result.get("error"):
                    return {
                        "success": True,
                        "result": result,
                        "summary": f"No path found: {result['error']}"
                    }
                
                readable = result.get("readable_path", "")
                narrative = result.get("narrative", "")
                
                return {
                    "success": True,
                    "result": result,
                    "summary": f"Path found ({result.get('path_length', 0)} hops): {readable}. {narrative}"
                }
            
            elif tool_name == "get_kill_chain":
                from app.services.graph_rag_service import get_graph_rag_service
                
                # Check cache - kill chain is expensive and changes rarely
                cache_key = f"{session_id}:get_kill_chain"
                cached = _query_cache.get(cache_key)
                if cached is not None:
                    return cached
                
                graph_service = get_graph_rag_service()
                result = graph_service.get_kill_chain(session_id=session_id)
                
                summary = result.get("summary", "No attack chain detected")
                stages = result.get("stages_detected", 0)
                
                return_val = {
                    "success": True,
                    "result": result,
                    "summary": f"Kill chain analysis: {stages} stages detected. {summary}"
                }
                _query_cache.set(cache_key, return_val)
                return return_val
            
            elif tool_name == "search_iocs":
                from app.models import Chunk, Session, Entity
                
                ioc_type = params.get("ioc_type", "all").lower()
                pattern = params.get("pattern", "")
                
                session = Session.query.filter_by(session_id=session_id).first()
                if not session:
                    return {"success": False, "result": [], "summary": "Session not found"}
                
                # Map ioc_type to entity types
                type_mapping = {
                    'ip': ['ipv4', 'ipv6'],
                    'domain': ['domain'],
                    'url': ['domain'],  # URLs often stored as domains
                    'hash': ['hash_md5', 'hash_sha1', 'hash_sha256'],
                    'all': ['ipv4', 'ipv6', 'domain', 'hash_md5', 'hash_sha1', 'hash_sha256']
                }
                
                entity_types = type_mapping.get(ioc_type, type_mapping['all'])
                
                # Query entities
                query = Entity.query.filter(
                    Entity.session_id == session.id,
                    Entity.entity_type.in_(entity_types)
                )
                
                # Apply pattern filter if specified
                if pattern:
                    query = query.filter(Entity.entity_value.ilike(f'%{pattern}%'))
                
                entities = query.limit(50).all()
                
                if not entities:
                    return {
                        "success": True,
                        "result": [],
                        "summary": f"No IOCs of type '{ioc_type}' found" + (f" matching '{pattern}'" if pattern else "")
                    }
                
                # Format results with context
                formatted = []
                by_type = {}
                for e in entities:
                    # Get the chunk for context
                    chunk = Chunk.query.filter_by(chunk_id=e.chunk_id).first()
                    source = chunk.source_file if chunk else "unknown"
                    
                    formatted.append({
                        "type": e.entity_type,
                        "value": e.entity_value,
                        "source": source,
                        "context": e.context_snippet[:200] if e.context_snippet else ""
                    })
                    
                    if e.entity_type not in by_type:
                        by_type[e.entity_type] = []
                    by_type[e.entity_type].append(e.entity_value)
                
                # Build summary
                summary_parts = []
                for t, vals in by_type.items():
                    unique_vals = list(set(vals))[:5]
                    summary_parts.append(f"{t}: {', '.join(unique_vals)}")
                
                return {
                    "success": True,
                    "result": formatted,
                    "summary": f"Found {len(entities)} IOCs. {'; '.join(summary_parts)}"
                }
            
            elif tool_name == "search_similar_commands":
                from app.models import Chunk, Session, Entity
                import re as regex
                
                raw_binary = params.get("binary_name", "").lower()
                
                # Handle compound binary names (e.g., "wget, curl" or "wget curl")
                # Split on comma, space, or "and"/"or"
                binary_names = regex.split(r'[,\s]+|(?:\s+and\s+)|(?:\s+or\s+)', raw_binary)
                binary_names = [b.strip() for b in binary_names if b.strip() and len(b.strip()) > 1]
                
                if not binary_names:
                    return {"success": False, "result": [], "summary": "No valid binary name provided"}
                
                session = Session.query.filter_by(session_id=session_id).first()
                if not session:
                    return {"success": False, "result": [], "summary": "Session not found"}
                
                # Search for each binary name
                commands_found = []
                sources = set()
                
                for binary_name in binary_names:
                    # Search for command entities containing the binary
                    command_entities = Entity.query.filter(
                        Entity.session_id == session.id,
                        Entity.entity_type == 'command',
                        Entity.entity_value.ilike(f'%{binary_name}%')
                    ).limit(20).all()
                    
                    # Also search directly in chunks for bash history entries
                    chunk_matches = Chunk.query.filter(
                        Chunk.session_id == session.id,
                        Chunk.content.ilike(f'%{binary_name}%'),
                        Chunk.source_file.ilike('%history%')
                    ).order_by(Chunk.importance_score.desc()).limit(15).all()
                    
                    # From entity extraction
                    for e in command_entities:
                        chunk = Chunk.query.filter_by(chunk_id=e.chunk_id).first()
                        source = chunk.source_file if chunk else "unknown"
                        sources.add(source)
                        commands_found.append({
                            "binary": binary_name,
                            "command": e.entity_value,
                            "source": source,
                            "context": e.context_snippet[:300] if e.context_snippet else ""
                        })
                    
                    # From direct chunk search
                    for chunk in chunk_matches:
                        for line in chunk.content.split('\n'):
                            if binary_name in line.lower() and len(line.strip()) > 0:
                                if not any(c['command'] == line.strip() for c in commands_found):
                                    sources.add(chunk.source_file)
                                    commands_found.append({
                                        "binary": binary_name,
                                        "command": line.strip()[:200],
                                        "source": chunk.source_file,
                                        "context": ""
                                    })
                
                if not commands_found:
                    binaries_str = ', '.join(binary_names)
                    return {
                        "success": True,
                        "result": [],
                        "summary": f"No '{binaries_str}' commands found"
                    }
                
                # Deduplicate
                seen = set()
                unique_commands = []
                for c in commands_found:
                    cmd_key = c['command'][:100]
                    if cmd_key not in seen:
                        seen.add(cmd_key)
                        unique_commands.append(c)
                
                binaries_str = ', '.join(binary_names)
                
                # Extract IPs from commands for suggestion
                import re as regex
                ip_pattern = r'\b(?:\d{1,3}\.){3}\d{1,3}\b'
                found_ips = set()
                for cmd in unique_commands:
                    ips = regex.findall(ip_pattern, cmd.get('command', ''))
                    found_ips.update(ips)
                
                # Build summary with suggestion
                summary = f"Found {len(unique_commands)} commands for '{binaries_str}'. Sources: {', '.join(list(sources)[:5])}"
                if found_ips:
                    ip_list = ', '.join(list(found_ips)[:3])
                    summary += f". TIP: Use traverse_graph on IP '{list(found_ips)[0]}' to see what else this IP is connected to."
                
                return {
                    "success": True,
                    "result": unique_commands[:15],  # Limit for context window
                    "summary": summary
                }
            
            elif tool_name == "get_temporal_context":
                from app.models import Chunk, Session
                
                reference_text = params.get("reference_text", "")
                window_minutes = int(params.get("window_minutes", 5))
                
                session = Session.query.filter_by(session_id=session_id).first()
                if not session:
                    return {"success": False, "result": [], "summary": "Session not found"}
                
                # Find the reference chunk
                ref_chunk = Chunk.query.filter(
                    Chunk.session_id == session.id,
                    Chunk.content.ilike(f'%{reference_text[:100]}%')
                ).first()
                
                if not ref_chunk:
                    return {
                        "success": True,
                        "result": [],
                        "summary": "Reference text not found in chunks"
                    }
                
                # Get chunks from the same source file (temporal proximity)
                same_source = Chunk.query.filter(
                    Chunk.session_id == session.id,
                    Chunk.source_file == ref_chunk.source_file
                ).order_by(Chunk.id).all()
                
                # Find position and get surrounding chunks
                context_chunks = []
                ref_idx = None
                for i, c in enumerate(same_source):
                    if c.id == ref_chunk.id:
                        ref_idx = i
                        break
                
                if ref_idx is not None:
                    # Get 5 chunks before and after
                    start_idx = max(0, ref_idx - 5)
                    end_idx = min(len(same_source), ref_idx + 6)
                    
                    for i in range(start_idx, end_idx):
                        c = same_source[i]
                        context_chunks.append({
                            "source": c.source_file,
                            "text": c.content[:400],
                            "is_reference": (i == ref_idx),
                            "position": "before" if i < ref_idx else ("after" if i > ref_idx else "reference")
                        })
                
                return {
                    "success": True,
                    "result": context_chunks,
                    "summary": f"Found {len(context_chunks)} entries around the reference. Source: {ref_chunk.source_file}"
                }
            
            elif tool_name == "find_related_commands":
                from app.models import Chunk, Session, Entity
                import re as regex
                
                reference_command = params.get("reference_command", "")
                relation_type = params.get("relation_type", "all").lower()
                
                session = Session.query.filter_by(session_id=session_id).first()
                if not session:
                    return {"success": False, "result": [], "summary": "Session not found"}
                
                related_commands = []
                sources = set()
                
                # First, find chunks containing the reference
                ref_chunks = Chunk.query.filter(
                    Chunk.session_id == session.id,
                    Chunk.content.ilike(f'%{reference_command[:100]}%')
                ).limit(5).all()
                
                if not ref_chunks:
                    return {
                        "success": True,
                        "result": [],
                        "summary": f"Reference '{reference_command[:50]}' not found in data"
                    }
                
                # Extract entities from reference chunks to find relationships
                ref_sources = set(c.source_file for c in ref_chunks)
                
                # Find commands from same source files (same_source relation)
                if relation_type in ["same_source", "all"]:
                    for source in list(ref_sources)[:3]:
                        source_chunks = Chunk.query.filter(
                            Chunk.session_id == session.id,
                            Chunk.source_file == source
                        ).order_by(Chunk.id).limit(30).all()
                        
                        for chunk in source_chunks:
                            # Look for command-like patterns
                            lines = chunk.content.split('\n')
                            for line in lines:
                                line = line.strip()
                                if line and len(line) > 3 and not line.startswith('#'):
                                    # Check if looks like a command
                                    cmd_indicators = ['wget', 'curl', 'chmod', 'sudo', 'ssh', 'nc', 'python', 'perl', 'bash', 'sh', '/', 'http']
                                    if any(ind in line.lower() for ind in cmd_indicators):
                                        if line not in [c.get('command') for c in related_commands]:
                                            sources.add(chunk.source_file)
                                            related_commands.append({
                                                "command": line[:200],
                                                "source": chunk.source_file,
                                                "relation": "same_source"
                                            })
                
                # Find by same IP (extract IPs from reference and find other occurrences)
                if relation_type in ["same_ip", "all"]:
                    ip_pattern = r'\b(?:\d{1,3}\.){3}\d{1,3}\b'
                    found_ips = set()
                    for chunk in ref_chunks:
                        ips = regex.findall(ip_pattern, chunk.content)
                        found_ips.update(ips)
                    
                    for ip in list(found_ips)[:3]:
                        # Skip common localhost/private
                        if ip.startswith('127.') or ip.startswith('0.'):
                            continue
                        
                        ip_chunks = Chunk.query.filter(
                            Chunk.session_id == session.id,
                            Chunk.content.ilike(f'%{ip}%')
                        ).limit(20).all()
                        
                        for chunk in ip_chunks:
                            if chunk.id not in [c.id for c in ref_chunks]:
                                # Extract lines with the IP
                                for line in chunk.content.split('\n'):
                                    if ip in line and line.strip():
                                        if line not in [c.get('command') for c in related_commands]:
                                            sources.add(chunk.source_file)
                                            related_commands.append({
                                                "command": line.strip()[:200],
                                                "source": chunk.source_file,
                                                "relation": f"same_ip ({ip})"
                                            })
                
                # Find by same user (look for username patterns)
                if relation_type in ["same_user", "all"]:
                    # Try to find username in reference
                    user_pattern = r'(?:user[=:\s]+|uid[=:\s]+\d+[^:\n]*:)(\w+)'
                    for chunk in ref_chunks:
                        users = regex.findall(user_pattern, chunk.content, regex.IGNORECASE)
                        for user in users[:2]:
                            if len(user) >= 2:
                                user_chunks = Chunk.query.filter(
                                    Chunk.session_id == session.id,
                                    Chunk.content.ilike(f'%{user}%')
                                ).limit(15).all()
                                
                                for uc in user_chunks:
                                    if uc.id not in [c.id for c in ref_chunks]:
                                        # Look for commands in user's context
                                        for line in uc.content.split('\n'):
                                            if user.lower() in line.lower() and line.strip():
                                                if line not in [c.get('command') for c in related_commands]:
                                                    sources.add(uc.source_file)
                                                    related_commands.append({
                                                        "command": line.strip()[:200],
                                                        "source": uc.source_file,
                                                        "relation": f"same_user ({user})"
                                                    })
                
                # Deduplicate
                seen = set()
                unique_results = []
                for c in related_commands:
                    key = c['command'][:80]
                    if key not in seen:
                        seen.add(key)
                        unique_results.append(c)
                
                if not unique_results:
                    return {
                        "success": True,
                        "result": [],
                        "summary": f"No related commands found for '{reference_command[:50]}'"
                    }
                
                return {
                    "success": True,
                    "result": unique_results[:15],
                    "summary": f"Found {len(unique_results)} related commands. Relations: {', '.join(set(c['relation'].split(' ')[0] for c in unique_results[:5]))}. Sources: {', '.join(list(sources)[:3])}"
                }
            
            elif tool_name == "get_attack_timeline":
                from app.models import Chunk, Session, Entity
                from datetime import datetime
                import re as regex
                
                entity_value = params.get("entity_value", "")
                limit = int(params.get("limit", 20))
                
                session = Session.query.filter_by(session_id=session_id).first()
                if not session:
                    return {"success": False, "result": [], "summary": "Session not found"}
                
                # Find all chunks containing this entity
                chunks = Chunk.query.filter(
                    Chunk.session_id == session.id,
                    Chunk.content.ilike(f'%{entity_value}%')
                ).order_by(Chunk.source_file, Chunk.id).limit(limit * 2).all()
                
                if not chunks:
                    return {
                        "success": True,
                        "result": [],
                        "summary": f"No activity found for entity '{entity_value}'"
                    }
                
                # Build timeline entries
                timeline = []
                timestamp_patterns = [
                    r'(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})',  # ISO
                    r'((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})',  # Syslog
                    r'(\d{1,2}/\w{3}/\d{4}:\d{2}:\d{2}:\d{2})',  # Apache
                ]
                
                for chunk in chunks:
                    lines = chunk.content.split('\n')
                    for line in lines:
                        if entity_value.lower() in line.lower():
                            # Try to extract timestamp
                            timestamp = None
                            for pattern in timestamp_patterns:
                                match = regex.search(pattern, line)
                                if match:
                                    timestamp = match.group(1)
                                    break
                            
                            timeline.append({
                                "timestamp": timestamp or "unknown",
                                "source": chunk.source_file,
                                "event": line.strip()[:300],
                                "has_timestamp": timestamp is not None
                            })
                
                # Sort by timestamp if available, otherwise by source
                timeline_with_ts = [t for t in timeline if t['has_timestamp']]
                timeline_without_ts = [t for t in timeline if not t['has_timestamp']]
                
                # Sort those with timestamps
                timeline_with_ts.sort(key=lambda x: x['timestamp'])
                
                # Combine: timestamped first, then others
                sorted_timeline = timeline_with_ts + timeline_without_ts
                
                # Deduplicate
                seen = set()
                unique_timeline = []
                for entry in sorted_timeline:
                    key = entry['event'][:100]
                    if key not in seen:
                        seen.add(key)
                        unique_timeline.append(entry)
                
                # Limit results
                unique_timeline = unique_timeline[:limit]
                
                # Build summary
                sources = list(set(e['source'] for e in unique_timeline))
                timestamped = sum(1 for e in unique_timeline if e['has_timestamp'])
                
                return {
                    "success": True,
                    "result": unique_timeline,
                    "summary": f"Timeline: {len(unique_timeline)} events for '{entity_value}'. {timestamped} with timestamps. Sources: {', '.join(sources[:3])}"
                }
            
            elif tool_name == "save_finding":
                # Store findings in-memory for this investigation session
                finding = params.get("finding", "")
                severity = params.get("severity", "medium").lower()
                evidence = params.get("evidence", "")
                
                if not hasattr(self, '_findings'):
                    self._findings = {}
                
                if session_id not in self._findings:
                    self._findings[session_id] = []
                
                self._findings[session_id].append({
                    "finding": finding,
                    "severity": severity,
                    "evidence": evidence[:500],
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
                })
                
                severity_emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(severity, "⚪")
                
                return {
                    "success": True,
                    "result": {"saved": True, "total_findings": len(self._findings[session_id])},
                    "summary": f"{severity_emoji} Finding saved: {finding[:100]}. Total findings: {len(self._findings[session_id])}"
                }
            
            elif tool_name == "extract_from_text":
                from app.services.entity_extractor import get_entity_extractor
                
                text = params.get("text", "")
                entity_type = params.get("entity_type", "all").lower()
                
                if not text:
                    return {
                        "success": True,
                        "result": [],
                        "summary": "No text provided to extract from"
                    }
                
                extractor = get_entity_extractor()
                entities = extractor.extract_entities(text)
                
                # Filter by type if specified
                type_mapping = {
                    'ip': ['ipv4', 'ipv6'],
                    'domain': ['domain'],
                    'url': ['url'],
                    'command': ['command'],
                    'hash': ['hash'],
                    'all': None  # No filter
                }
                
                allowed_types = type_mapping.get(entity_type)
                if allowed_types:
                    entities = [e for e in entities if e.entity_type in allowed_types]
                
                if not entities:
                    return {
                        "success": True,
                        "result": [],
                        "summary": f"No {entity_type if entity_type != 'all' else ''} entities found in the text"
                    }
                
                # Format results
                formatted = []
                by_type = {}
                for e in entities:
                    formatted.append({
                        "type": e.entity_type,
                        "value": e.value,
                        "normalized": e.normalized_value
                    })
                    if e.entity_type not in by_type:
                        by_type[e.entity_type] = []
                    by_type[e.entity_type].append(e.value)
                
                # Build summary
                summary_parts = []
                for t, values in by_type.items():
                    summary_parts.append(f"{t}: {', '.join(values[:5])}")
                
                return {
                    "success": True,
                    "result": formatted,
                    "summary": f"Extracted {len(formatted)} entities: {'; '.join(summary_parts)}"
                }
            
            else:
                return {
                    "success": False,
                    "result": None,
                    "summary": f"Unknown tool: {tool_name}"
                }
                
        except Exception as e:
            return {
                "success": False,
                "result": None,
                "summary": f"Tool error: {str(e)}"
            }
    
    def _get_session_context(self, session_id: str) -> str:
        """Get brief context about the session for the agent."""
        from app.models import Session
        
        session = Session.query.filter_by(session_id=session_id).first()
        if not session:
            return "No session context available."
        
        parts = []
        if session.hostname:
            parts.append(f"Hostname: {session.hostname}")
        if session.os_type:
            parts.append(f"OS: {session.os_type}")
        if session.total_chunks:
            parts.append(f"Total chunks: {session.total_chunks}")
        if session.collection_date:
            parts.append(f"Collection date: {session.collection_date}")
        
        return " | ".join(parts) if parts else "Session loaded, ready for analysis."
    
    def query_stream(self, session_id: str, query: str, 
                     user_id: int = 1,
                     conversation_history: list = None,
                     investigation_context: str = "") -> Generator[str, None, None]:
        """
        Run agentic query with streamed output showing reasoning.
        
        Args:
            session_id: The forensic session to query
            query: User's question
            user_id: User making the query
            conversation_history: List of previous messages [{"role": "user"|"assistant", "content": "..."}]
            investigation_context: User-provided background about the incident
        
        Yields:
            Formatted strings showing agent's thinking and tool calls
        """
        start_time = time.time()
        
        # Get session context
        session_context = self._get_session_context(session_id)
        
        # Format conversation history for the agent
        conv_context = ""
        if conversation_history:
            conv_context = "\n\nCONVERSATION HISTORY (remember this context):\n"
            for msg in conversation_history[-6:]:  # Last 6 messages for context window
                role = msg.get("role", "user").upper()
                content = msg.get("content", "")[:2000]  # Keep more context for follow-ups
                conv_context += f"{role}: {content}\n"
            conv_context += "\n(IMPORTANT: When user refers to 'the output', 'those IPs', 'the commands above', etc., look at your previous ASSISTANT response and extract the specific values mentioned.)\n"
        
        # Include user-provided investigation context
        incident_context = ""
        if investigation_context and investigation_context.strip():
            incident_context = f"\n\nINVESTIGATOR'S CONTEXT (background provided by analyst):\n{investigation_context.strip()}\n\n(Use this context to guide your investigation. The analyst may know details about the incident that are not in the logs.)\n"
        
        # Agent tool call history (within this query)
        tool_history = []
        iteration = 0
        final_answer = None
        
        yield "🔍 **Starting investigation...**\n\n"
        
        while iteration < self.MAX_ITERATIONS:
            iteration += 1
            
            # Build prompt with history
            prompt = self._build_agent_prompt(query, session_context + incident_context + conv_context, tool_history)
            
            # Get agent response
            yield f"**Step {iteration}:** "
            
            try:
                response = self.provider.generate(prompt)
                agent_text = response.content
            except Exception as e:
                error_msg = str(e)
                if "429" in error_msg or "rate" in error_msg.lower() or "quota" in error_msg.lower():
                    yield "⚠️ LLM rate limit exceeded. Please wait a minute and try again.\n"
                elif "404" in error_msg or "not found" in error_msg.lower():
                    yield f"⚠️ LLM model not found. Please check your model configuration in Settings. Error: {error_msg}\n"
                else:
                    yield f"⚠️ Error communicating with LLM: {error_msg}\n"
                break
            
            # Parse response
            parsed = self._parse_agent_response(agent_text)
            
            # Show thinking
            if parsed["thinking"]:
                yield f"*Thinking: {parsed['thinking'][:200]}...*\n\n" if len(parsed["thinking"]) > 200 else f"*{parsed['thinking']}*\n\n"
            
            tool_name = parsed["tool"]
            params = parsed["params"]
            
            if not tool_name:
                yield "Could not parse tool call, retrying...\n"
                continue
            
            # Show tool call
            yield f"📎 Using **{tool_name}**"
            if params and tool_name != "final_answer":
                params_str = ", ".join(f"{k}='{v}'" for k, v in params.items() if v)
                yield f" ({params_str})"
            yield "\n"
            
            # Execute tool
            tool_result = self._execute_tool(session_id, tool_name, params)
            
            # Check for final answer
            if tool_result.get("is_final"):
                final_answer = tool_result.get("result", "")
                yield "\n---\n\n"
                yield f"**Answer:**\n\n{final_answer}"
                break
            
            # Show result summary
            yield f"  → {tool_result.get('summary', 'No results')}\n\n"
            
            # Add to tool history for next iteration
            tool_history.append({
                "action": tool_name,
                "params": params,
                "result_summary": tool_result.get("summary"),
                "result_preview": str(tool_result.get("result", ""))[:500]
            })
        
        # If we hit max iterations without final answer
        if final_answer is None:
            yield "\n---\n\n"
            yield "**Answer:**\n\n"
            
            # Try to get a final answer from what we've gathered
            if tool_history:
                summary_prompt = f"""You are a forensic analyst assistant. Based on the investigation steps taken, provide a direct answer to the user's question.

Original Question: {query}
{conv_context}
Investigation Results:
{json.dumps(tool_history, indent=2)}

Instructions:
1. Summarize what was found based on the search results
2. If there were no relevant results, say so clearly
3. If more investigation would be needed, mention what to look for
4. Be concise but complete

Answer:"""
                try:
                    response = self.provider.generate(summary_prompt)
                    yield response.content
                except Exception as e:
                    error_msg = str(e)
                    if "429" in error_msg or "rate" in error_msg.lower() or "quota" in error_msg.lower():
                        yield "⚠️ LLM rate limit exceeded. Please wait a minute and try again."
                    else:
                        yield f"Based on the investigation, {len(tool_history)} searches were performed but a final summary could not be generated. "
                        yield "Please review the investigation steps above for details, or try rephrasing your question."
            else:
                yield "No investigation results were gathered — the LLM could not be reached or the configured model is unavailable. Please verify your LLM provider settings (model name, API key, endpoint) in Settings."
        
        elapsed = time.time() - start_time
        yield f"\n\n---\n*Investigation completed in {elapsed:.1f}s ({iteration} steps)*"
    
    def query(self, session_id: str, query: str, user_id: int = 1) -> str:
        """
        Run agentic query and return full response.
        
        Returns:
            Complete response string
        """
        response_parts = []
        for chunk in self.query_stream(session_id, query, user_id):
            response_parts.append(chunk)
        return "".join(response_parts)


# Singleton instance
_agentic_service = None

def get_agentic_rag_service(rag_service: TieredRAGService = None) -> AgenticRAGService:
    """Get the singleton agentic RAG service."""
    global _agentic_service
    if _agentic_service is None or rag_service is not None:
        _agentic_service = AgenticRAGService(rag_service)
    return _agentic_service
