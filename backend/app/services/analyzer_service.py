"""
Analyzer Service - AI-powered forensic analysis using multi-provider LLM with Tiered RAG.

This service handles natural language queries, summary generation,
and anomaly detection using the configured LLM provider with tiered RAG storage.

Following RAG_DESIGN.md:
- Minimal context sent to LLM (top 3-5 chunks)
- Pre-filtering before vector search
- Domain-specific prompts for DFIR

Supported providers: Ollama, OpenAI, Gemini, Claude
"""
from typing import Generator, Any
from datetime import datetime
from pathlib import Path
import json
import hashlib
import time

from app.models import db, QueryLog, Session
from app.services.tiered_rag_service import TieredRAGService
from app.services.llm_providers import ProviderFactory, get_provider


class AnalyzerService:
    """Service for AI-powered forensic analysis with tiered RAG and multi-provider LLM."""
    
    def __init__(self, ollama_url: str = None, model: str = None, chroma_persist_dir: Path = None,
                 chunk_size: int = 512, chunk_overlap: int = 50, hot_cache_size: int = 1000):
        """
        Initialize the analyzer service.
        
        Args:
            ollama_url: Base URL for Ollama API (legacy, now uses provider config)
            model: Model name to use for inference (legacy, now uses provider config)
            chroma_persist_dir: Path for ChromaDB persistence
        """
        # Get LLM provider from factory (ignores legacy ollama_url/model params)
        self._provider = None
        self.rag_service = TieredRAGService(
            chroma_persist_dir=chroma_persist_dir,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            hot_cache_size=hot_cache_size
        )
    
    @property
    def provider(self):
        """Get current LLM provider (lazy loaded)."""
        if self._provider is None:
            self._provider = get_provider()
        return self._provider
    
    @property
    def model(self):
        """Get current model name for logging."""
        return self.provider.get_model()
    
    def _filter_think_tags(self, token_stream: Generator[str, None, None]) -> Generator[str, None, None]:
        """
        Filter out <think>...</think> blocks from token stream.
        
        Some models (like Claude) emit internal reasoning in <think> tags.
        This filter removes those blocks from the user-visible output.
        """
        buffer = ""
        in_think_block = False
        
        for token in token_stream:
            buffer += token
            
            # Process buffer looking for think tags
            while buffer:
                if in_think_block:
                    # Look for closing tag
                    close_idx = buffer.find("</think>")
                    if close_idx != -1:
                        # Found closing tag, skip everything up to and including it
                        buffer = buffer[close_idx + 8:]
                        in_think_block = False
                    else:
                        # Still in think block, clear buffer (discard content)
                        # But keep last 8 chars in case </think> is split across tokens
                        if len(buffer) > 8:
                            buffer = buffer[-8:]
                        break
                else:
                    # Look for opening tag
                    open_idx = buffer.find("<think>")
                    if open_idx != -1:
                        # Yield everything before the tag
                        if open_idx > 0:
                            yield buffer[:open_idx]
                        buffer = buffer[open_idx + 7:]
                        in_think_block = True
                    else:
                        # Check for partial tag at end
                        # If buffer ends with something that could be start of <think>
                        partial_tag = False
                        for i in range(1, min(7, len(buffer) + 1)):
                            if buffer.endswith("<think>"[:i]):
                                # Yield all but the partial tag
                                yield buffer[:-i]
                                buffer = buffer[-i:]
                                partial_tag = True
                                break
                        
                        if not partial_tag:
                            # No tag or partial tag, yield entire buffer
                            yield buffer
                            buffer = ""
                        break
        
        # Yield any remaining buffer (only if not in think block)
        if buffer and not in_think_block:
            yield buffer
    
    def query_stream(self, session_id: str, query: str, 
                     user_id: int = 1, conversation_history: list = None) -> Generator[str, None, None]:
        """
        Stream a response to a natural language query using RAG.
        
        Optimized retrieval pipeline:
        1. Fast complexity estimation (no LLM)
        2. Single LLM call for query rewriting/expansion
        3. Optional multi-query only for complex queries
        4. Optional HyDE only for semantic queries (not keyword searches)
        5. Fast regex entity extraction for boosting
        
        Args:
            session_id: Session identifier for context
            query: The user query text
            user_id: User making the query (for logging)
            conversation_history: Previous messages for context [{role, content}, ...]
            
        Yields:
            Token strings as they are generated
        """
        start_time = time.time()
        
        if conversation_history is None:
            conversation_history = []
        
        # Step 1: Fast complexity estimation (regex-based, no LLM)
        adaptive_top_k = self._estimate_query_complexity(query)
        is_complex = adaptive_top_k >= 15  # Complex if needs many chunks
        is_semantic = not self._is_keyword_query(query)  # Semantic if not looking for specific terms
        
        # Step 2: Collect chunks using optimized strategy
        all_chunks = {}  # chunk_id -> chunk data (deduped)
        total_retrieval_time = 0
        
        # Primary retrieval: Always rewrite query once
        rewritten_query = self._rewrite_query_with_llm(query)
        
        result = self.rag_service.query(
            session_id=session_id,
            query_text=rewritten_query,
            artifact_categories=None,
            top_k=adaptive_top_k,
            use_reranking=True,
            include_context_window=True
        )
        
        total_retrieval_time += result.get('retrieval_time_ms', 0)
        
        for chunk in result.get('chunks', []):
            cid = chunk.get('chunk_id')
            if cid:
                all_chunks[cid] = chunk
        
        # Step 3: Multi-query only for complex queries (saves LLM calls for simple questions)
        if is_complex and len(all_chunks) < adaptive_top_k:
            # Generate additional query variations (one LLM call)
            extra_queries = self._generate_multi_queries(query)
            
            # Query with variations (skip original, already did it)
            for q_variant in extra_queries[1:2]:  # Just use first variation, not all 3
                result = self.rag_service.query(
                    session_id=session_id,
                    query_text=q_variant,  # Already rewritten by multi-query generator
                    artifact_categories=None,
                    top_k=adaptive_top_k // 2,
                    use_reranking=True,
                    include_context_window=False  # Skip context window for speed
                )
                
                total_retrieval_time += result.get('retrieval_time_ms', 0)
                
                for chunk in result.get('chunks', []):
                    cid = chunk.get('chunk_id')
                    if cid and cid not in all_chunks:
                        all_chunks[cid] = chunk
        
        # Step 4: HyDE only for semantic queries that need it
        # Skip HyDE for keyword searches (IPs, paths, usernames) - they work better with BM25
        if is_semantic and len(all_chunks) < adaptive_top_k // 2:
            hyde_doc = self._generate_hyde_document(query)
            
            if hyde_doc != query:
                hyde_result = self.rag_service.query(
                    session_id=session_id,
                    query_text=hyde_doc,
                    artifact_categories=None,
                    top_k=5,  # Just a few HyDE results
                    use_reranking=False,  # Skip reranking for speed
                    include_context_window=False
                )
                
                total_retrieval_time += hyde_result.get('retrieval_time_ms', 0)
                
                for chunk in hyde_result.get('chunks', []):
                    cid = chunk.get('chunk_id')
                    if cid and cid not in all_chunks:
                        chunk['relevance_score'] = chunk.get('relevance_score', 0) * 0.85
                        all_chunks[cid] = chunk
        
        # Step 5: Apply relevance feedback boost and sort
        final_chunks = list(all_chunks.values())
        
        # Apply learned relevance boost (Phase 6: Relevance Feedback)
        try:
            from app.services.relevance_feedback_service import get_relevance_feedback_service
            feedback_service = get_relevance_feedback_service()
            final_chunks = feedback_service.apply_relevance_boost(final_chunks, session_id)
        except Exception as e:
            # Non-critical - continue without boost
            pass
        
        final_chunks.sort(key=lambda x: x.get('cross_encoder_score', x.get('relevance_score', 0)), reverse=True)
        top_chunks = final_chunks[:adaptive_top_k]
        
        # Record retrieval for relevance feedback
        try:
            chunk_ids = [c.get('chunk_id') for c in top_chunks if c.get('chunk_id')]
            feedback_service.record_retrieval(session_id, chunk_ids)
        except Exception:
            pass  # Non-critical
        
        # Assemble context from top chunks
        context_parts = []
        for chunk in top_chunks:
            source = chunk.get('source_file', 'unknown')
            text = chunk.get('text', '')
            if text:
                context_parts.append(f"[Source: {source}]\n{text}")
        
        context = "\n\n---\n\n".join(context_parts)
        retrieval_time = total_retrieval_time
        
        # Build prompt with retrieved context and conversation history
        # Note: Use original query (not rewritten) for the prompt - LLM sees what user asked
        prompt = self._build_query_prompt(query, context, conversation_history)
        
        # Track for query logging
        full_response = []
        
        # Stream from LLM provider with think-tag filtering
        try:
            raw_stream = self.provider.generate_stream(prompt)
            for token in self._filter_think_tags(raw_stream):
                full_response.append(token)
                yield token
            
            # Log query (async would be better but keeping simple)
            generation_time = int((time.time() - start_time) * 1000) - retrieval_time
            response_text = ''.join(full_response)
            
            self._log_query(
                session_id=session_id,
                user_id=user_id,
                query=query,
                response=response_text,
                retrieval_time=retrieval_time,
                generation_time=generation_time,
                chunks_retrieved=len(top_chunks)
            )
            
            # Record relevance feedback (which chunks were used in response)
            try:
                feedback_service.record_usage(
                    session_id=session_id,
                    retrieved_chunks=top_chunks,
                    response_text=response_text,
                    query_text=query
                )
            except Exception:
                pass  # Non-critical
                        
        except Exception as e:
            yield f'\n\n[Error communicating with LLM: {str(e)}]'
    
    def _rewrite_query_with_llm(self, query: str) -> str:
        """
        Use LLM to expand/rewrite the query for better retrieval.
        
        This converts user queries into forensic search terms that are more
        likely to match actual log file content.
        
        Example:
            Input: "show me .sh downloads"
            Output: "shell script bash .sh wget curl download /tmp chmod +x 
                     transfer http ftp scp executable script file"
        """
        rewrite_prompt = f'''You are a forensic search query optimizer for Linux/Unix system artifacts.

Rewrite the following user query into search terms that would match actual log file content.
The logs come from UAC (Unix-like Artifacts Collector) and include:
- /var/log/auth.log, syslog, messages
- bash_history, command history
- crontabs, systemd services
- network connections, process lists
- file system artifacts

User Query: {query}

Respond with ONLY a single line of search keywords (no explanation, no bullet points).
Include:
- Synonyms and related terms
- Linux file paths and command names
- Log format patterns the user might be looking for
- Keep it under 100 words

Search keywords:'''

        try:
            # Use fast, single-shot generation for query rewriting
            response = self.provider.generate(rewrite_prompt)
            expanded = response.content.strip()
            
            # Validate response (should be a single line with keywords)
            if expanded and len(expanded) < 500 and '\n' not in expanded[:100]:
                # Combine original query with expanded terms
                return f"{query} {expanded}"
            else:
                # Fallback to original if LLM response is weird
                return query
        except Exception:
            # On any error, just return original query
            return query
    
    def _generate_multi_queries(self, query: str) -> list[str]:
        """
        Generate multiple query variations for better retrieval coverage.
        
        Multi-query retrieval significantly improves recall by searching
        with different perspectives of the same question.
        
        Returns:
            List of query variations (includes original)
        """
        prompt = f'''Generate 3 different search queries to find information about:
"{query}"

Make them diverse:
1. A literal/keyword-focused version (file paths, exact terms)
2. A conceptual/semantic version (what the user is really asking about)
3. A log-format-specific version (how this might appear in system logs)

Return ONLY the 3 queries, one per line, no numbering or explanation.'''

        try:
            response = self.provider.generate(prompt)
            lines = [l.strip() for l in response.content.strip().split('\n') if l.strip()]
            
            # Start with original query, add variations
            queries = [query]
            for line in lines[:3]:
                # Clean up any numbering or bullets
                clean = line.lstrip('0123456789.-) ').strip()
                if clean and clean != query and len(clean) < 300:
                    queries.append(clean)
            
            return queries[:4]  # Cap at 4 total queries
        except Exception:
            return [query]  # Fallback to just original
    
    def _estimate_query_complexity(self, query: str) -> int:
        """
        Estimate how many chunks we need based on query complexity.
        
        Simple queries need fewer chunks, complex investigations need more.
        
        Returns:
            Recommended top_k value
        """
        query_lower = query.lower()
        words = query.split()
        
        # Very simple queries
        if len(words) < 4:
            return 5
        
        # Timeline/sequence queries need more context
        timeline_keywords = ['timeline', 'sequence', 'when', 'before', 'after', 
                           'first', 'last', 'order', 'chronological']
        if any(kw in query_lower for kw in timeline_keywords):
            return 20
        
        # Investigation/comprehensive queries
        investigation_keywords = ['all', 'everything', 'comprehensive', 'full',
                                 'investigate', 'analysis', 'summary']
        if any(kw in query_lower for kw in investigation_keywords):
            return 25
        
        # Multi-aspect queries (and, or, also, both)
        multi_keywords = ['and', 'or', 'also', 'both', 'including', 'as well']
        if any(kw in query_lower for kw in multi_keywords):
            return 15
        
        # Comparison queries
        compare_keywords = ['compare', 'difference', 'versus', 'vs', 'between']
        if any(kw in query_lower for kw in compare_keywords):
            return 15
        
        # Default for medium complexity
        return 10
    
    def _is_keyword_query(self, query: str) -> bool:
        """
        Detect if the query is looking for specific values vs semantic meaning.
        
        Keyword queries (IPs, paths, usernames) work better with BM25.
        Semantic queries (what happened, explain) work better with vectors.
        
        Returns:
            True if query appears to be keyword/exact-match focused
        """
        import re
        
        # Check for IP addresses
        if re.search(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', query):
            return True
        
        # Check for file paths
        if re.search(r'/[\w./]+', query):
            return True
        
        # Check for specific technical terms (ports, hashes, etc.)
        if re.search(r'\b(port\s*\d+|sha\d+|md5|hash)\b', query, re.IGNORECASE):
            return True
        
        # Check for quoted strings (user looking for exact match)
        if '"' in query or "'" in query:
            return True
        
        # Check for specific command names
        command_pattern = r'\b(wget|curl|nc|netcat|chmod|rm|sudo|ssh|scp|cron|iptables)\b'
        if re.search(command_pattern, query, re.IGNORECASE):
            return True
        
        # Check for username patterns
        if re.search(r'\buser\s*[=:]\s*\w+', query, re.IGNORECASE):
            return True
        
        return False
    
    def _generate_hyde_document(self, query: str) -> str:
        """
        Generate a Hypothetical Document Embedding (HyDE) for better retrieval.
        
        HyDE works by generating a hypothetical answer, then searching for
        chunks similar to that answer. This is especially effective for
        questions where the answer format is predictable.
        
        Returns:
            Hypothetical document text for embedding search
        """
        prompt = f'''You are analyzing Linux forensic artifacts from UAC (Unix-like Artifacts Collector).
A forensic analyst asks: "{query}"

Write a hypothetical excerpt from actual log files that would answer this question.
Include realistic:
- Timestamps (e.g., Jan 15 14:32:01)
- Linux file paths (e.g., /var/log/auth.log)
- Usernames, IP addresses
- Command outputs or log formats

Keep it under 150 words. Write ONLY the log excerpt, no explanation.'''

        try:
            response = self.provider.generate(prompt)
            hyde_doc = response.content.strip()
            
            # Validate it looks like log content
            if hyde_doc and len(hyde_doc) < 1000:
                return hyde_doc
            return query
        except Exception:
            return query
    
    def _infer_categories(self, query: str) -> list[str] | None:
        """
        Infer artifact categories from query to enable pre-filtering.
        
        Per RAG_DESIGN.md: Pre-filtering is MANDATORY before vector search.
        """
        query_lower = query.lower()
        categories = []
        
        # Map query keywords to categories - expanded for DFIR
        category_keywords = {
            'users': ['user', 'account', 'passwd', 'login', 'who', 'uid', 'gid', 'home', 'owner'],
            'authentication': ['auth', 'login', 'ssh', 'password', 'sudo', 'failed', 'brute', 'crack'],
            'network': ['network', 'ip', 'port', 'connection', 'listen', 'socket', 'dns', 'curl', 'wget', 'download', 'upload', 'transfer', 'http'],
            'persistence': ['cron', 'startup', 'service', 'systemd', 'persist', 'autorun', 'init', 'rc.local'],
            'processes': ['process', 'pid', 'running', 'memory', 'cpu', 'ps ', 'top', 'execute', 'spawn'],
            'logs': ['log', 'event', 'audit', 'syslog', 'journal', 'error', 'warning', 'message'],
            'configuration': ['config', 'setting', 'permission', 'etc', 'conf', 'enable', 'disable'],
            'filesystem': ['file', 'directory', 'folder', 'path', '.sh', '.py', '.pl', 'script', 'binary', 'executable', 'find', 'ls'],
            'commands': ['command', 'history', 'bash', 'shell', 'executed', 'ran', 'run'],
        }
        
        for category, keywords in category_keywords.items():
            if any(kw in query_lower for kw in keywords):
                categories.append(category)
        
        # Return None if no specific categories (will search all)
        return categories if categories else None
    
    def _log_query(self, session_id: str, user_id: int, query: str, 
                   response: str, retrieval_time: int, generation_time: int,
                   chunks_retrieved: int) -> None:
        """Log query for analytics and caching."""
        session = Session.query.filter_by(session_id=session_id).first()
        if not session:
            return
        
        query_hash = hashlib.sha256(
            f'{session_id}:{query}'.encode()
        ).hexdigest()
        
        log = QueryLog(
            investigation_id=session.investigation_id,
            user_id=user_id,
            query_text=query,
            query_hash=query_hash,
            query_type='chat',
            response_text=response[:10000],  # Cap at 10k chars
            chunks_retrieved=chunks_retrieved,
            retrieval_time_ms=retrieval_time,
            generation_time_ms=generation_time,
            model_used=self.model
        )
        db.session.add(log)
        db.session.commit()
    
    def generate_summary(self, session_id: str) -> dict[str, Any]:
        """
        Generate an incident summary for the session using RAG.
        
        Args:
            session_id: Session identifier
            
        Returns:
            Summary content and metadata
        """
        # Get broad context for summary - query multiple categories
        rag_result = self.rag_service.query(
            session_id=session_id,
            query_text='system overview hostname users processes network connections security configuration',
            artifact_categories=['users', 'network', 'configuration', 'processes'],
            top_k=10  # More context for summary
        )
        
        context = rag_result.get('context', 'No artifacts found.')
        prompt = self._build_summary_prompt(context)
        response = self._call_ollama(prompt)
        
        return {
            'content': response,
            'chunks_used': len(rag_result.get('chunks', [])),
            'generated_at': datetime.utcnow().isoformat()
        }
    
    def extract_iocs(self, session_id: str) -> dict[str, Any]:
        """
        Extract indicators of compromise (IOCs) from forensic data.
        
        Uses both regex pattern matching and LLM analysis to identify:
        - IP addresses (IPv4, IPv6)
        - Domain names and URLs
        - File hashes (MD5, SHA1, SHA256)
        - File paths
        - Email addresses
        - User accounts
        - Process names
        
        Args:
            session_id: Session identifier
            
        Returns:
            Structured IOC data with categories and context
        """
        import re
        
        iocs = {
            'ip_addresses': [],
            'domains': [],
            'urls': [],
            'file_hashes': [],
            'file_paths': [],
            'email_addresses': [],
            'user_accounts': [],
            'suspicious_processes': [],
            'registry_keys': [],
            'commands': [],
        }
        
        # Patterns for IOC extraction
        patterns = {
            'ipv4': re.compile(r'\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b'),
            'ipv6': re.compile(r'\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b'),
            'domain': re.compile(r'\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b'),
            'url': re.compile(r'https?://[^\s<>"{}|\\^`\[\]]+'),
            'md5': re.compile(r'\b[a-fA-F0-9]{32}\b'),
            'sha1': re.compile(r'\b[a-fA-F0-9]{40}\b'),
            'sha256': re.compile(r'\b[a-fA-F0-9]{64}\b'),
            'email': re.compile(r'\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b'),
            'unix_path': re.compile(r'(?:/[a-zA-Z0-9._-]+)+(?:/[a-zA-Z0-9._-]*)?'),
            'windows_path': re.compile(r'[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*'),
        }
        
        # Skip common false positives
        skip_ips = {'127.0.0.1', '0.0.0.0', '255.255.255.255', '::1'}
        skip_domains = {'localhost', 'example.com', 'test.com'}
        skip_paths = {'/bin', '/usr', '/etc', '/var', '/home', '/tmp', '/dev', '/proc', '/sys'}
        
        # Query for network-related artifacts
        network_result = self.rag_service.query(
            session_id=session_id,
            query_text='IP address connection network socket listen established remote host domain DNS URL',
            artifact_categories=['network', 'logs'],
            top_k=10
        )
        
        # Query for file/hash artifacts
        file_result = self.rag_service.query(
            session_id=session_id,
            query_text='hash MD5 SHA1 SHA256 checksum file path binary executable suspicious',
            artifact_categories=['hash_data', 'logs', 'processes'],
            top_k=10
        )
        
        # Query for user/process artifacts
        user_result = self.rag_service.query(
            session_id=session_id,
            query_text='user account login process command execute shell bash suspicious unauthorized',
            artifact_categories=['users', 'authentication', 'processes'],
            top_k=10
        )
        
        # Combine all context
        all_context = '\n'.join([
            network_result.get('context', ''),
            file_result.get('context', ''),
            user_result.get('context', '')
        ])
        
        # Extract IOCs using patterns
        seen = set()
        
        # Extract IPs
        for match in patterns['ipv4'].finditer(all_context):
            ip = match.group()
            if ip not in skip_ips and ip not in seen:
                seen.add(ip)
                iocs['ip_addresses'].append({
                    'value': ip,
                    'type': 'ipv4',
                    'context': all_context[max(0, match.start()-50):match.end()+50]
                })
        
        for match in patterns['ipv6'].finditer(all_context):
            ip = match.group()
            if ip not in seen:
                seen.add(ip)
                iocs['ip_addresses'].append({
                    'value': ip,
                    'type': 'ipv6',
                    'context': all_context[max(0, match.start()-50):match.end()+50]
                })
        
        # Extract URLs
        for match in patterns['url'].finditer(all_context):
            url = match.group()
            if url not in seen:
                seen.add(url)
                iocs['urls'].append({
                    'value': url,
                    'context': all_context[max(0, match.start()-30):match.end()+30]
                })
        
        # Extract domains (not already part of URLs)
        for match in patterns['domain'].finditer(all_context):
            domain = match.group().lower()
            if domain not in skip_domains and domain not in seen and not any(domain in url['value'] for url in iocs['urls']):
                # Skip common system domains
                if not any(domain.endswith(x) for x in ['.local', '.internal', '.home']):
                    seen.add(domain)
                    iocs['domains'].append({
                        'value': domain,
                        'context': all_context[max(0, match.start()-30):match.end()+30]
                    })
        
        # Extract file hashes
        for hash_type, pattern in [('md5', patterns['md5']), ('sha1', patterns['sha1']), ('sha256', patterns['sha256'])]:
            for match in pattern.finditer(all_context):
                hash_val = match.group().lower()
                if hash_val not in seen:
                    seen.add(hash_val)
                    iocs['file_hashes'].append({
                        'value': hash_val,
                        'type': hash_type,
                        'context': all_context[max(0, match.start()-50):match.end()+50]
                    })
        
        # Extract Unix paths (interesting ones only)
        for match in patterns['unix_path'].finditer(all_context):
            path = match.group()
            # Only include suspicious paths
            if path not in seen and len(path) > 5:
                if any(x in path.lower() for x in ['/tmp/', '/dev/shm/', 'hidden', '.', '/var/tmp/', '/run/']):
                    seen.add(path)
                    iocs['file_paths'].append({
                        'value': path,
                        'type': 'unix',
                        'suspicious': True,
                        'context': all_context[max(0, match.start()-30):match.end()+30]
                    })
        
        # Extract emails
        for match in patterns['email'].finditer(all_context):
            email = match.group().lower()
            if email not in seen:
                seen.add(email)
                iocs['email_addresses'].append({
                    'value': email,
                    'context': all_context[max(0, match.start()-30):match.end()+30]
                })
        
        # Use LLM for additional context and classification
        prompt = self._build_ioc_prompt(all_context)
        llm_response = self._call_ollama(prompt)
        
        # Count total IOCs
        total_iocs = sum(len(v) for v in iocs.values())
        
        return {
            'iocs': iocs,
            'total_count': total_iocs,
            'llm_analysis': llm_response,
            'chunks_analyzed': (
                len(network_result.get('chunks', [])) + 
                len(file_result.get('chunks', [])) + 
                len(user_result.get('chunks', []))
            )
        }
    
    def _build_ioc_prompt(self, context: str) -> str:
        """Build prompt for IOC analysis."""
        return f'''You are a threat intelligence analyst. Analyze the following forensic artifacts and identify any indicators of compromise (IOCs).

FORENSIC DATA:
{context[:8000]}

Provide a brief analysis covering:

1. **Network IOCs**: Suspicious IP addresses, domains, or URLs with context on why they are suspicious
2. **File-based IOCs**: Notable file hashes, suspicious file paths, or malicious binaries
3. **Behavioral IOCs**: Suspicious commands, processes, or user activity patterns
4. **Attribution hints**: Any indicators that might suggest the threat actor or malware family

For each IOC, explain:
- Why it is suspicious
- What investigation steps are recommended
- Any known associations (if recognizable)

Keep the analysis concise and actionable.'''
    
    # Pre-built forensic detection rules for rule-based anomaly detection
    DETECTION_RULES = {
        # Persistence mechanisms
        'persistence': [
            (r'/tmp/\.[^/]+', 'Hidden file in /tmp', 'medium'),
            (r'/dev/shm/\.[^/]+', 'Hidden file in /dev/shm', 'high'),
            (r'@reboot\s+', 'Cron @reboot entry', 'medium'),
            (r'/etc/rc\.local', 'rc.local modification', 'medium'),
            (r'\.bashrc.*curl|wget', 'Download command in bashrc', 'high'),
            (r'/etc/ld\.so\.preload', 'LD_PRELOAD hijacking', 'critical'),
            (r'ExecStart.*nc\s+-|ncat|netcat', 'Netcat in systemd service', 'high'),
        ],
        # Suspicious accounts
        'accounts': [
            (r'uid[=:]0.*(?!root)', 'Non-root user with UID 0', 'critical'),
            (r'/etc/passwd.*:0:0:', 'Additional root-level account', 'critical'),
            (r'authorized_keys.*command=', 'SSH key with forced command', 'medium'),
            (r'/bin/bash.*uid[=:]0', 'Shell account with root privileges', 'high'),
            (r'\.ssh/.*777|666', 'Weak SSH key permissions', 'medium'),
        ],
        # Privilege escalation
        'privesc': [
            (r'NOPASSWD.*ALL', 'Passwordless sudo ALL', 'high'),
            (r'chmod\s+[4267][0-7]{2}\s+', 'SUID/SGID bit set', 'medium'),
            (r'setuid|setgid|setcap', 'Capability/SUID manipulation', 'medium'),
            (r'sudo.*-i|-s|su\s+-', 'Interactive root shell', 'low'),
            (r'/etc/sudoers\.d/', 'Custom sudoers drop-in', 'low'),
        ],
        # Network indicators
        'network': [
            (r'0\.0\.0\.0:(?!22|80|443|53)\d+.*LISTEN', 'Unusual listening port', 'medium'),
            (r'ESTABLISHED.*:(?:4444|5555|1337|31337|6666|6667)', 'Suspicious port connection', 'high'),
            (r'nc\s+-[le]|ncat.*-[le]|socat.*EXEC', 'Reverse/bind shell pattern', 'critical'),
            (r'\.onion|tor2web', 'Tor network indicator', 'high'),
            (r'/etc/hosts\s+.*(?!localhost|127\.0\.0\.1)', 'Modified hosts file', 'medium'),
        ],
        # Malware indicators
        'malware': [
            (r'base64\s+-d|base64\s+--decode', 'Base64 decode execution', 'medium'),
            (r'eval\s*\(.*base64', 'Eval with base64', 'high'),
            (r'python.*-c\s+[\'"]import', 'Python one-liner execution', 'medium'),
            (r'curl.*\|\s*sh|wget.*\|\s*sh|bash', 'Pipe to shell pattern', 'critical'),
            (r'/proc/self/exe', 'Self-referential execution', 'medium'),
            (r'memfd:|deleted\)', 'Memory-only execution', 'critical'),
            (r'LD_PRELOAD|LD_LIBRARY_PATH', 'Library injection', 'high'),
        ],
        # Data exfiltration
        'exfil': [
            (r'curl.*POST.*@|wget.*--post-file', 'File upload via HTTP', 'medium'),
            (r'tar.*\|\s*nc|gzip.*\|\s*nc', 'Archive piped to netcat', 'high'),
            (r'scp.*\*|rsync.*-a.*/', 'Bulk file transfer', 'low'),
            (r'/etc/shadow|/etc/passwd.*cat|less|head', 'Credential file access', 'medium'),
        ],
        # Log tampering
        'log_tampering': [
            (r'echo\s*>\s*/var/log|truncate.*log|shred.*log', 'Log file manipulation', 'critical'),
            (r'history\s*-c|HISTFILE=/dev/null', 'History clearing', 'high'),
            (r'unset\s+HISTFILE|HISTSIZE=0', 'History disabled', 'high'),
            (r'touch\s+-[amt]|timestomp', 'Timestamp manipulation', 'high'),
        ],
        # Crypto mining
        'cryptomining': [
            (r'xmrig|minerd|cgminer|cpuminer', 'Cryptocurrency miner', 'high'),
            (r'stratum\+tcp|pool\.|:3333|:4444', 'Mining pool connection', 'high'),
            (r'--donate-level|--coin|--algo', 'Mining arguments', 'high'),
        ],
    }
    
    def detect_anomalies(self, session_id: str) -> dict[str, Any]:
        """
        Detect anomalies in the forensic data using multi-pass RAG and rule-based detection.
        
        Uses multiple targeted queries for different attack categories plus
        regex-based rule detection for known IOCs.
        
        Args:
            session_id: Session identifier
            
        Returns:
            List of detected anomalies with scores and evidence
        """
        import re
        
        all_anomalies = []
        chunks_analyzed = 0
        
        # Multi-pass queries targeting different attack vectors
        security_queries = [
            {
                'query': 'sudo NOPASSWD root uid=0 setuid capabilities privilege escalation',
                'categories': ['authentication', 'users', 'configuration'],
                'focus': 'privilege_escalation'
            },
            {
                'query': 'cron systemd rc.local .bashrc .profile autorun persistence startup boot',
                'categories': ['persistence', 'configuration'],
                'focus': 'persistence'
            },
            {
                'query': 'LISTEN ESTABLISHED netcat nc ncat socat bind reverse shell connection',
                'categories': ['network', 'processes'],
                'focus': 'network_backdoor'
            },
            {
                'query': 'ssh authorized_keys public key authentication root login',
                'categories': ['authentication', 'configuration'],
                'focus': 'ssh_security'
            },
            {
                'query': 'base64 decode eval exec python perl ruby wget curl download',
                'categories': ['processes', 'logs'],
                'focus': 'code_execution'
            },
            {
                'query': 'hidden .dot tmp shm deleted memfd suspicious process',
                'categories': ['processes', 'configuration'],
                'focus': 'hidden_artifacts'
            },
            {
                'query': 'failed login invalid authentication error denied brute',
                'categories': ['authentication', 'logs'],
                'focus': 'authentication_attacks'
            },
        ]
        
        # Collect context from multiple targeted queries
        all_context_parts = []
        
        for query_spec in security_queries:
            try:
                rag_result = self.rag_service.query(
                    session_id=session_id,
                    query_text=query_spec['query'],
                    artifact_categories=query_spec['categories'],
                    top_k=5
                )
                context = rag_result.get('context', '')
                if context:
                    all_context_parts.append(f"=== {query_spec['focus'].upper()} ===\n{context}")
                    chunks_analyzed += len(rag_result.get('chunks', []))
                    
                    # Apply rule-based detection on retrieved chunks
                    rule_anomalies = self._apply_detection_rules(
                        context, 
                        query_spec['focus']
                    )
                    all_anomalies.extend(rule_anomalies)
                    
            except Exception:
                continue
        
        # Combine contexts and run LLM analysis
        combined_context = "\n\n".join(all_context_parts)
        
        if combined_context:
            prompt = self._build_anomaly_prompt(combined_context)
            response = self._call_ollama(prompt)
            
            # Parse LLM findings
            llm_anomalies = self._parse_anomalies(response)
            
            # Merge rule-based and LLM findings, avoiding duplicates
            for llm_anomaly in llm_anomalies:
                if not self._is_duplicate_anomaly(llm_anomaly, all_anomalies):
                    all_anomalies.append(llm_anomaly)
        
        # Sort by severity score descending
        all_anomalies.sort(key=lambda x: x.get('score', 0), reverse=True)
        
        return {
            'anomalies': all_anomalies,
            'chunks_analyzed': chunks_analyzed,
            'detection_passes': len(security_queries),
            'rule_based_findings': sum(1 for a in all_anomalies if a.get('detection_method') == 'rule'),
            'llm_findings': sum(1 for a in all_anomalies if a.get('detection_method') != 'rule')
        }
    
    def _apply_detection_rules(self, context: str, focus_area: str) -> list[dict]:
        """Apply regex-based detection rules to context."""
        import re
        
        anomalies = []
        
        # Select relevant rule categories based on focus
        rule_categories = {
            'privilege_escalation': ['privesc', 'accounts'],
            'persistence': ['persistence', 'malware'],
            'network_backdoor': ['network', 'malware'],
            'ssh_security': ['accounts', 'persistence'],
            'code_execution': ['malware', 'exfil'],
            'hidden_artifacts': ['persistence', 'log_tampering'],
            'authentication_attacks': ['accounts', 'privesc'],
        }
        
        categories_to_check = rule_categories.get(focus_area, list(self.DETECTION_RULES.keys()))
        
        for category in categories_to_check:
            rules = self.DETECTION_RULES.get(category, [])
            for pattern, description, severity in rules:
                try:
                    matches = re.finditer(pattern, context, re.IGNORECASE | re.MULTILINE)
                    for match in matches:
                        # Get context around match
                        start = max(0, match.start() - 50)
                        end = min(len(context), match.end() + 50)
                        evidence = context[start:end].strip()
                        
                        anomalies.append({
                            'type': category,
                            'severity': severity,
                            'score': {'low': 0.3, 'medium': 0.5, 'high': 0.8, 'critical': 1.0}.get(severity, 0.5),
                            'description': description,
                            'evidence': f"...{evidence}...",
                            'detection_method': 'rule',
                            'pattern': pattern
                        })
                except re.error:
                    continue
        
        return anomalies
    
    def _is_duplicate_anomaly(self, new_anomaly: dict, existing: list[dict]) -> bool:
        """Check if anomaly is a duplicate based on type and evidence."""
        new_type = new_anomaly.get('type', '')
        new_evidence = new_anomaly.get('evidence', '')[:100]
        
        for existing_anomaly in existing:
            if (existing_anomaly.get('type', '') == new_type and 
                new_evidence in existing_anomaly.get('evidence', '')):
                return True
        return False
    
    def _build_query_prompt(self, query: str, context: str, conversation_history: list = None) -> str:
        """Build prompt for user query with RAG context and conversation history."""
        # Build conversation context
        history_text = ""
        if conversation_history:
            history_text = "\n\nPREVIOUS CONVERSATION:\n"
            for msg in conversation_history[-6:]:  # Keep last 6 messages for context
                role = msg.get('role', 'user').upper()
                content = msg.get('content', '')[:500]  # Truncate long messages
                history_text += f"{role}: {content}\n"
            history_text += "\n"
        
        # Check if we have meaningful context
        has_context = bool(context and context.strip() and len(context.strip()) > 50)
        
        no_data_instruction = ""
        if not has_context:
            no_data_instruction = """
IMPORTANT: The forensic evidence provided is empty or insufficient.
Please inform the user that no relevant data was found for their query.
DO NOT make up or hallucinate any information."""
        
        return f'''You are a digital forensics expert analyzing output from UAC (Unix-like Artifacts Collector).

CRITICAL CONTEXT:
- UAC is a forensic collection tool for UNIX/LINUX systems (NOT Windows User Account Control)
- The data comes from Linux/Unix systems: /var/log, /etc, /home, cron, systemd, bash_history, etc.
- This is NOT Windows data. Do not mention Windows Event Viewer, Windows registry, or Windows-specific artifacts.
- Typical artifacts include: syslog, auth.log, bash_history, crontabs, passwd/shadow, network configs, process lists

FORENSIC EVIDENCE FROM TARGET SYSTEM:
{context if has_context else "(No relevant artifacts were retrieved for this query)"}
{history_text}
USER QUESTION: {query}
{no_data_instruction}
RESPONSE INSTRUCTIONS:
- Base your answer ONLY on the forensic evidence provided above
- If the evidence section is empty or doesn't contain relevant information, clearly state: "No relevant data found in the forensic artifacts for this query"
- NEVER invent, assume, or hallucinate data that isn't in the evidence
- Quote specific file paths, usernames, IP addresses, timestamps directly from the evidence
- Cite the source file for each claim (e.g., "According to /var/log/auth.log...")
- If you identify suspicious indicators, highlight them with context from the actual data
- For follow-up questions, use conversation history but still only cite actual evidence'''

    def _build_summary_prompt(self, context: str) -> str:
        """Build prompt for incident summary."""
        # Check if we have meaningful context
        has_context = bool(context and context.strip() and len(context.strip()) > 50)
        
        if not has_context:
            return f'''You are a digital forensics expert analyzing UAC (Unix-like Artifacts Collector) output from a Linux/Unix system.

The forensic evidence retrieved is empty or insufficient to generate a meaningful summary.

Please respond with a brief message explaining that no artifacts were available for analysis.
DO NOT invent or hallucinate any system information.'''
        
        return f'''You are a digital forensics expert analyzing UAC (Unix-like Artifacts Collector) output.

CRITICAL CONTEXT:
- UAC collects forensic artifacts from UNIX/LINUX systems (NOT Windows)
- This data comes from Linux paths: /var/log, /etc, /home, cron, systemd, etc.
- Do NOT mention Windows-specific artifacts (Event Viewer, registry, etc.)

FORENSIC ARTIFACTS:
{context}

Generate a markdown-formatted incident summary including:

## Executive Summary
Brief overview of the UNIX/Linux system and any notable findings.

## System Information
- Hostname, Linux distribution, kernel version if available
- Key users found on the system (/etc/passwd entries)
- Network configuration (interfaces, IPs)

## Key Findings
Notable discoveries from the artifacts.

## Security Observations
Any security-relevant findings (suspicious processes, unusual configurations, etc.)

## Timeline of Events
If timestamps are available, create a brief timeline.

## Recommendations
Suggested next steps for investigation.

IMPORTANT:
- Base your analysis ONLY on the evidence provided
- Be specific and cite artifact sources (e.g., "From /var/log/auth.log:...")
- If a section has no relevant data, state "No data available" instead of making assumptions'''
    
    def _build_anomaly_prompt(self, context: str) -> str:
        """Build prompt for anomaly detection with specific IOC patterns."""
        # Check if we have meaningful context
        has_context = bool(context and context.strip() and len(context.strip()) > 50)
        
        if not has_context:
            return '''You are analyzing UAC (Unix-like Artifacts Collector) output from a Linux/Unix system.

The forensic evidence retrieved is empty or insufficient for anomaly detection.

Please respond with a message explaining that no artifacts were available to analyze for anomalies.
DO NOT invent or fabricate any findings.'''
        
        return f'''You are an expert digital forensics analyst and threat hunter analyzing UAC (Unix-like Artifacts Collector) output.

CRITICAL CONTEXT:
- UAC collects forensic artifacts from UNIX/LINUX systems (NOT Windows)
- Data sources include: /var/log, /etc, cron, systemd, bash_history, process lists, network configs
- Do NOT reference Windows artifacts (Event Viewer, registry, etc.)

FORENSIC EVIDENCE FROM TARGET LINUX/UNIX SYSTEM:
{context}

DETECTION FOCUS AREAS (Linux/Unix specific):
1. **Persistence Mechanisms**
   - Cron jobs, systemd services, rc.local, bashrc/profile modifications
   - Hidden files in /tmp, /dev/shm, /var/tmp
   - Unusual startup scripts or autorun entries

2. **Privilege Escalation**
   - SUID/SGID binaries, especially in /tmp or user directories
   - sudoers misconfigurations (NOPASSWD, ALL privileges)
   - Additional users with UID 0 or sudo group membership
   - Capabilities abuse

3. **Unauthorized Access**
   - Multiple failed login attempts from same source
   - SSH keys with forced commands or unusual authorized_keys entries
   - Login from unusual IPs or at unusual times
   - Brute force indicators

4. **Backdoors & C2**
   - Unusual LISTEN ports or outbound connections
   - Known malware ports (4444, 5555, 1337, etc.)
   - Netcat/socat/reverse shell patterns
   - Encoded commands (base64, xor)

5. **Malware Indicators**
   - Processes running from /tmp, /dev/shm, or deleted files
   - Memory-only execution (memfd)
   - Cryptocurrency miners
   - Unusual process names or masquerading

6. **Data Exfiltration**
   - Large data transfers
   - Archive creation followed by network activity
   - Access to sensitive files (/etc/shadow, private keys)

7. **Anti-Forensics**
   - Log tampering or deletion
   - History clearing (HISTFILE, history -c)
   - Timestamp manipulation
   - Shredding/secure deletion commands

For each finding, provide:
- **Type**: Category (persistence, privesc, backdoor, malware, exfil, anti_forensics, unauthorized_access)
- **Severity**: critical, high, medium, or low
- **Description**: Clear explanation of what was found and why it is suspicious
- **Evidence**: The specific artifact, path, or log line that supports this finding
- **Recommendation**: What an analyst should investigate further

IMPORTANT:
- Base findings ONLY on the evidence provided above
- If no suspicious activity is found, clearly state that the artifacts appear normal
- Do NOT force findings or invent data that isn't present'''
    
    def _call_ollama(self, prompt: str) -> str:
        """Make a non-streaming call to the LLM provider."""
        try:
            response = self.provider.generate(prompt)
            return response.content
        except Exception as e:
            return f'Error communicating with LLM: {str(e)}'
    
    def _parse_anomalies(self, response: str) -> list[dict]:
        """
        Parse anomalies from LLM response.
        
        Attempts to extract structured anomaly data from the response.
        """
        anomalies = []
        
        # Try to parse structured findings
        lines = response.split('\n')
        current_anomaly = {}
        
        for line in lines:
            line = line.strip()
            if line.startswith('- **Type**:') or line.startswith('**Type**:'):
                if current_anomaly and current_anomaly.get('type'):
                    current_anomaly['detection_method'] = 'llm'
                    anomalies.append(current_anomaly)
                current_anomaly = {
                    'type': line.split(':', 1)[1].strip().strip('*').lower().replace(' ', '_'),
                    'severity': 'medium',
                    'description': '',
                    'evidence': '',
                    'recommendation': '',
                    'score': 0.5
                }
            elif line.startswith('- **Severity**:') or line.startswith('**Severity**:'):
                severity = line.split(':', 1)[1].strip().lower().strip('*')
                if current_anomaly:
                    current_anomaly['severity'] = severity
                    current_anomaly['score'] = {
                        'low': 0.3, 'medium': 0.5, 'high': 0.8, 'critical': 1.0
                    }.get(severity, 0.5)
            elif line.startswith('- **Description**:') or line.startswith('**Description**:'):
                if current_anomaly:
                    current_anomaly['description'] = line.split(':', 1)[1].strip().strip('*')
            elif line.startswith('- **Evidence**:') or line.startswith('**Evidence**:'):
                if current_anomaly:
                    current_anomaly['evidence'] = line.split(':', 1)[1].strip().strip('*')
            elif line.startswith('- **Recommendation**:') or line.startswith('**Recommendation**:'):
                if current_anomaly:
                    current_anomaly['recommendation'] = line.split(':', 1)[1].strip().strip('*')
        
        if current_anomaly and current_anomaly.get('type'):
            current_anomaly['detection_method'] = 'llm'
            anomalies.append(current_anomaly)
        
        # If parsing failed, return raw analysis
        if not anomalies:
            # Check if the response indicates no findings
            no_findings_indicators = [
                'no anomalies', 'no suspicious', 'appear normal', 'no evidence',
                'nothing suspicious', 'no indicators', 'clean', 'no issues'
            ]
            response_lower = response.lower()
            
            if any(indicator in response_lower for indicator in no_findings_indicators):
                return [{
                    'type': 'analysis_complete',
                    'severity': 'info',
                    'score': 0.0,
                    'description': 'No suspicious activity detected in analyzed artifacts.',
                    'evidence': 'Automated and LLM analysis found no IOCs.',
                    'detection_method': 'llm'
                }]
            
            return [{
                'type': 'raw_analysis',
                'severity': 'medium',
                'score': 0.5,
                'description': 'Anomaly detection completed. Review raw analysis below.',
                'evidence': 'See raw_analysis field',
                'raw_analysis': response[:3000] if len(response) > 3000 else response,
                'detection_method': 'llm'
            }]
        
        return anomalies
