/**
 * ChatMessage - Rich message display with collapsible reasoning and references
 * 
 * Parses agentic RAG responses and displays:
 * - Collapsible thinking/reasoning steps
 * - Tool calls with results
 * - Final answer (highlighted)
 * - Source references
 */
import { useState, useMemo } from "react";
import { 
  ChevronDown, ChevronRight, Copy, Download, Check, 
  Brain, Search, GitBranch, FileText, Target, Loader2,
  BookOpen, ExternalLink, Clock
} from "lucide-react";

// Types
export interface MessageSource {
  file: string;
  chunk_id?: string;
  relevance?: number;
}

export interface AgentStep {
  type: "thinking" | "tool" | "result" | "answer";
  content: string;
  tool?: string;
  params?: string;
  timestamp?: number;
}

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isAgentic?: boolean;
  sources?: MessageSource[];
  steps?: AgentStep[];
}

interface ChatMessageProps {
  message: ChatMessageData;
  isStreaming?: boolean;
  showSources?: boolean;
  onSourceClick?: (source: MessageSource) => void;
}

// Tool icons
const toolIcons: Record<string, typeof Search> = {
  search_chunks: Search,
  search_entity: Target,
  list_entities: FileText,
  traverse_graph: GitBranch,
  find_path: GitBranch,
  get_kill_chain: Target,
  final_answer: Check,
};

// Parse agentic response into structured steps and answer
function parseAgenticResponse(content: string): { steps: AgentStep[]; answer: string; sources: MessageSource[] } {
  const steps: AgentStep[] = [];
  const sources: MessageSource[] = [];
  let answer = "";

  // Check if this is an agentic response (has investigation markers)
  const isAgentic = content.includes('🔍') || content.includes('**Step ') || content.includes('📎 Using');
  
  if (!isAgentic) {
    // Not an agentic response - return content as-is
    return { steps: [], answer: content, sources: [] };
  }

  // Split content by the answer separator (---) with flexible whitespace
  // The answer typically comes after "---" near the end
  const parts = content.split(/\n+---\n+/);
  
  // The last meaningful part after --- is usually the answer
  // But we need to handle the footer "*Investigation completed..."
  let answerPart = "";
  let stepsPart = parts[0] || "";
  
  if (parts.length > 1) {
    // Find the answer part (after ---, but filter out footer)
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i].trim();
      // Skip empty parts and the investigation footer
      if (!part || part.startsWith('*Investigation completed')) continue;
      
      // This is likely the answer
      answerPart = part;
    }
  }

  // Parse steps from the first part
  const lines = stepsPart.split('\n');
  let currentStep: AgentStep | null = null;

  for (const line of lines) {
    // Starting investigation marker
    if (line.includes('🔍') || line.includes('Starting investigation')) {
      continue;
    }

    // Step marker: **Step N:**
    if (line.match(/^\*\*Step \d+:\*\*/)) {
      if (currentStep) steps.push(currentStep);
      currentStep = { type: "thinking", content: "" };
      continue;
    }

    // Thinking: *Thinking: ...* or *...*
    if (line.match(/^\*Thinking:/i) || (line.startsWith('*') && line.endsWith('*') && line.length > 2)) {
      const thinking = line.replace(/^\*Thinking:\s*/i, '').replace(/^\*/, '').replace(/\*$/, '').trim();
      if (currentStep && thinking) {
        currentStep.type = "thinking";
        currentStep.content = thinking;
      }
      continue;
    }

    // Tool call: 📎 Using **tool_name** (params)
    if (line.includes('📎') || line.match(/Using \*\*\w+\*\*/)) {
      if (currentStep) steps.push(currentStep);
      const toolMatch = line.match(/Using \*\*(\w+)\*\*/);
      const paramsMatch = line.match(/\(([^)]+)\)/);
      currentStep = {
        type: "tool",
        content: line,
        tool: toolMatch?.[1] || "unknown",
        params: paramsMatch?.[1] || ""
      };
      continue;
    }

    // Tool result: → result
    if (line.match(/^\s*→/) || line.match(/^  →/)) {
      const result = line.replace(/^\s*→\s*/, '').trim();
      if (currentStep) {
        steps.push(currentStep);
        currentStep = { type: "result", content: result };
      }
      continue;
    }
  }

  // Push remaining step
  if (currentStep) steps.push(currentStep);

  // Clean up answer - remove **Answer:** prefix if present
  answer = answerPart
    .replace(/^\*\*Answer:\*\*\s*/i, '')
    .replace(/^\*\*Reached maximum investigation steps.*?\*\*\s*/i, '')
    .trim();

  // If we still have no answer but have steps, try to find anything after the last step
  if (!answer && steps.length > 0) {
    // Look for content after the investigation footer
    const footerMatch = content.match(/\*Investigation completed[^*]*\*/);
    if (footerMatch) {
      const afterFooter = content.split(footerMatch[0])[1]?.trim();
      if (afterFooter) {
        answer = afterFooter;
      }
    }
    
    // Last resort: indicate no specific answer was provided
    if (!answer) {
      // Check if there's an Answer section we might have missed
      const answerMatch = content.match(/\*\*Answer:\*\*\s*([\s\S]*?)(?=\n---|\*Investigation|$)/i);
      if (answerMatch) {
        answer = answerMatch[1].trim();
      }
    }
  }

  // Extract sources from the whole content
  const fileMatches = content.match(/`([^`]+\.(evtx|reg|txt|log|json|csv|xml|sh|conf|py|js))`/gi);
  if (fileMatches) {
    fileMatches.forEach(match => {
      const file = match.replace(/`/g, '');
      if (!sources.find(s => s.file === file)) {
        sources.push({ file });
      }
    });
  }

  // Also extract paths mentioned without backticks (common in forensic responses)
  const pathMatches = content.match(/(?:\/[\w.-]+)+(?:\.[\w]+)?/g);
  if (pathMatches) {
    pathMatches.forEach(path => {
      if (path.length > 5 && !sources.find(s => s.file === path)) {
        sources.push({ file: path });
      }
    });
  }

  return { steps, answer, sources };
}

// Collapsible reasoning section
function ReasoningSteps({ steps, defaultExpanded = false }: { steps: AgentStep[]; defaultExpanded?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (steps.length === 0) return null;

  const thinkingSteps = steps.filter(s => s.type === "thinking" || s.type === "tool" || s.type === "result");

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors group"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <Brain className="w-4 h-4 text-brand-primary" />
        <span>Reasoning ({thinkingSteps.length} steps)</span>
      </button>

      {isExpanded && (
        <div className="mt-3 ml-6 space-y-2 border-l-2 border-border-subtle pl-4">
          {thinkingSteps.map((step, i) => (
            <StepDisplay key={i} step={step} index={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// Individual step display
function StepDisplay({ step, index }: { step: AgentStep; index: number }) {
  const Icon = step.tool ? (toolIcons[step.tool] || Search) : Brain;

  if (step.type === "thinking") {
    return (
      <div className="flex items-start gap-2 text-sm">
        <div className="shrink-0 w-5 h-5 rounded-full bg-brand-primary/10 flex items-center justify-center text-xs text-brand-primary">
          {index}
        </div>
        <p className="text-text-secondary italic">{step.content}</p>
      </div>
    );
  }

  if (step.type === "tool") {
    return (
      <div className="flex items-start gap-2 text-sm">
        <div className="shrink-0 w-5 h-5 rounded-full bg-info/10 flex items-center justify-center">
          <Icon className="w-3 h-3 text-info" />
        </div>
        <div>
          <span className="text-text-primary font-medium">{step.tool}</span>
          {step.params && (
            <span className="text-text-muted ml-2 font-mono text-xs">({step.params})</span>
          )}
        </div>
      </div>
    );
  }

  if (step.type === "result") {
    return (
      <div className="flex items-start gap-2 text-sm ml-7">
        <span className="text-success">→</span>
        <p className="text-text-secondary">{step.content}</p>
      </div>
    );
  }

  return null;
}

// Sources/References panel
function SourcesPanel({ sources, onSourceClick }: { sources: MessageSource[]; onSourceClick?: (s: MessageSource) => void }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-border-subtle">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <BookOpen className="w-4 h-4" />
        <span>Sources ({sources.length})</span>
      </button>

      {isExpanded && (
        <div className="mt-2 ml-6 space-y-1">
          {sources.map((source, i) => (
            <button
              key={i}
              onClick={() => onSourceClick?.(source)}
              className="flex items-center gap-2 text-sm text-text-muted hover:text-brand-primary transition-colors group w-full text-left"
            >
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{source.file}</span>
              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Simple markdown-ish rendering for answer
function RenderAnswer({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  // Basic markdown rendering
  const rendered = useMemo(() => {
    let html = content
      // Headers
      .replace(/^### (.+)$/gm, '<h4 class="text-sm font-semibold text-text-primary mt-4 mb-2">$1</h4>')
      .replace(/^## (.+)$/gm, '<h3 class="text-base font-semibold text-text-primary mt-4 mb-2">$1</h3>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-text-primary">$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')
      // Code inline
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 bg-bg-elevated rounded text-brand-primary font-mono text-xs">$1</code>')
      // Lists
      .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
      // Line breaks
      .replace(/\n\n/g, '</p><p class="mt-3">')
      .replace(/\n/g, '<br/>');
    
    return `<p>${html}</p>`;
  }, [content]);

  return (
    <div className="prose prose-sm prose-invert max-w-none">
      <div 
        className="text-sm text-text-primary leading-relaxed"
        dangerouslySetInnerHTML={{ __html: rendered }} 
      />
      {isStreaming && content && (
        <span className="inline-block w-2 h-4 bg-brand-primary/70 ml-0.5 animate-pulse" />
      )}
    </div>
  );
}

// Streaming indicator
function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 text-text-muted">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-sm">Analyzing and generating response...</span>
    </div>
  );
}

// Main component
export function ChatMessage({ message, isStreaming = false, showSources = true, onSourceClick }: ChatMessageProps) {
  const isUser = message.role === "user";
  
  // Parse agentic response if it's an assistant message - BUT only when not streaming
  const { steps, answer, sources } = useMemo(() => {
    if (isUser) return { steps: [], answer: message.content, sources: [] };
    // Don't parse during streaming - show raw content instead
    if (isStreaming) return { steps: [], answer: message.content, sources: [] };
    return parseAgenticResponse(message.content);
  }, [message.content, isUser, isStreaming]);

  const showTypingIndicator = isStreaming && !message.content;

  // User message - simple bubble on right
  if (isUser) {
    return (
      <div className="flex justify-end gap-3 group">
        <div className="flex flex-col items-end max-w-[75%]">
          <div className="rounded-2xl rounded-tr-sm px-4 py-3 bg-gradient-to-br from-brand-primary to-brand-primary/90 text-white shadow-sm">
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
          </div>
          <div className="flex items-center gap-1 mt-1 text-xs text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            <Clock className="w-3 h-3" />
            <span>{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
        <div className="w-8 h-8 rounded-full bg-brand-primary/20 flex items-center justify-center shrink-0">
          <span className="text-brand-primary text-sm font-medium">U</span>
        </div>
      </div>
    );
  }

  // Assistant message - rich display on left
  return (
    <div className="flex justify-start gap-3 group">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-primary/20 to-purple-500/20 flex items-center justify-center shrink-0">
        <Brain className="w-4 h-4 text-brand-primary" />
      </div>
      <div className="flex-1 max-w-[85%]">
        {/* Message card */}
        <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-bg-surface border border-border-subtle shadow-sm">
          {showTypingIndicator ? (
            <StreamingIndicator />
          ) : isStreaming ? (
            // During streaming, show raw content with cursor
            <div className="prose prose-sm prose-invert max-w-none">
              <div className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                {message.content}
                <span className="inline-block w-2 h-4 bg-brand-primary/70 ml-0.5 animate-pulse" />
              </div>
            </div>
          ) : (
            <>
              {/* Collapsible reasoning steps */}
              {steps.length > 0 && (
                <ReasoningSteps steps={steps} defaultExpanded={false} />
              )}

              {/* Main answer */}
              {answer ? (
                <RenderAnswer content={answer} isStreaming={false} />
              ) : steps.length > 0 ? (
                <div className="text-text-secondary text-sm italic">
                  The investigation completed with {steps.length} steps but no specific answer was generated. 
                  Try refining your question or check the reasoning steps above for details.
                </div>
              ) : null}

              {/* Sources */}
              {showSources && sources.length > 0 && (
                <SourcesPanel sources={sources} onSourceClick={onSourceClick} />
              )}
            </>
          )}
        </div>

        {/* Actions and timestamp row */}
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1 text-xs text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            <Clock className="w-3 h-3" />
            <span>{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {message.isAgentic && <span className="ml-2 text-brand-primary/70">• Agent</span>}
          </div>
          
          {/* Actions */}
          {!isStreaming && message.content && (
            <MessageActionsInline content={message.content} />
          )}
        </div>
      </div>
    </div>
  );
}

// Inline message actions  
function MessageActionsInline({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={handleCopy}
        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
        title="Copy to clipboard"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <button
        onClick={() => {
          const blob = new Blob([content], { type: "text/markdown" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `response-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }}
        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
        title="Download"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default ChatMessage;
