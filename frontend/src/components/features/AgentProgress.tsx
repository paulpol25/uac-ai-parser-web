/**
 * AgentProgress - Shows real-time progress of agentic RAG during streaming
 * 
 * Displays:
 * - Current step being executed
 * - History of completed steps
 * - Elapsed time
 */
import { useState, useEffect, useCallback } from "react";
import { 
  Brain, Search, Target, FileText, GitBranch, Check, 
  Loader2, ChevronDown, ChevronUp
} from "lucide-react";
import clsx from "clsx";

export interface AgentProgressStep {
  id: number;
  type: "thinking" | "tool" | "result" | "complete";
  content: string;
  tool?: string;
  timestamp: number;
}

interface AgentProgressProps {
  isActive: boolean;
  steps: AgentProgressStep[];
  startTime: number | null;
  compact?: boolean;
}

const toolIcons: Record<string, typeof Search> = {
  search_chunks: Search,
  search_entity: Target,
  list_entities: FileText,
  traverse_graph: GitBranch,
  find_path: GitBranch,
  get_kill_chain: Target,
};

export function AgentProgress({ isActive, steps, startTime, compact = false }: AgentProgressProps) {
  const [isExpanded, setIsExpanded] = useState(!compact);
  const [elapsed, setElapsed] = useState(0);

  // Update elapsed time
  useEffect(() => {
    if (!isActive || !startTime) return;
    
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isActive, startTime]);

  if (!isActive && steps.length === 0) return null;

  const currentStep = steps[steps.length - 1];
  const completedSteps = steps.slice(0, -1);

  return (
    <div className={clsx(
      "rounded-lg border transition-all",
      isActive 
        ? "bg-brand-primary/5 border-brand-primary/30" 
        : "bg-bg-elevated border-border-subtle"
    )}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between text-sm"
      >
        <div className="flex items-center gap-2">
          {isActive ? (
            <Loader2 className="w-4 h-4 animate-spin text-brand-primary" />
          ) : (
            <Check className="w-4 h-4 text-success" />
          )}
          <span className="text-text-primary font-medium">
            {isActive ? "Investigating..." : "Investigation Complete"}
          </span>
          <span className="text-text-muted">
            {steps.length} step{steps.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {startTime && (
            <span className="text-text-muted text-xs">
              {elapsed}s
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border-subtle">
          {/* Progress timeline */}
          <div className="mt-3 space-y-1.5">
            {completedSteps.map((step, i) => (
              <StepItem key={step.id} step={step} index={i + 1} isComplete />
            ))}
            {currentStep && (
              <StepItem 
                step={currentStep} 
                index={steps.length} 
                isComplete={!isActive}
                isCurrent={isActive}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StepItem({ 
  step, 
  index, 
  isComplete, 
  isCurrent 
}: { 
  step: AgentProgressStep; 
  index: number; 
  isComplete: boolean;
  isCurrent?: boolean;
}) {
  const Icon = step.tool ? (toolIcons[step.tool] || Brain) : Brain;

  return (
    <div className={clsx(
      "flex items-center gap-2 text-xs",
      isCurrent && "text-brand-primary",
      isComplete && !isCurrent && "text-text-muted"
    )}>
      <div className={clsx(
        "w-5 h-5 rounded-full flex items-center justify-center shrink-0",
        isCurrent && "bg-brand-primary/20",
        isComplete && !isCurrent && "bg-bg-surface",
      )}>
        {isCurrent ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : step.type === "tool" ? (
          <Icon className="w-3 h-3" />
        ) : (
          <span className="text-[10px]">{index}</span>
        )}
      </div>
      <span className="truncate flex-1">
        {step.type === "tool" && step.tool ? (
          <>
            <span className="font-medium">{step.tool}</span>
            {step.content && <span className="text-text-muted ml-1">- {step.content}</span>}
          </>
        ) : (
          step.content
        )}
      </span>
      {isComplete && <Check className="w-3 h-3 text-success shrink-0" />}
    </div>
  );
}

// Hook to parse streaming content into steps
export function useAgentProgress(content: string, _isStreaming: boolean) {
  const [steps, setSteps] = useState<AgentProgressStep[]>([]);
  const [startTime, setStartTime] = useState<number | null>(null);

  // Parse content for steps  
  useEffect(() => {
    if (!content) {
      setSteps([]);
      return;
    }

    const newSteps: AgentProgressStep[] = [];
    const lines = content.split('\n');
    let stepId = 0;

    for (const line of lines) {
      // Starting investigation
      if (line.includes('🔍') || line.includes('Starting investigation')) {
        if (!startTime) setStartTime(Date.now());
        continue;
      }

      // Step marker
      if (line.match(/^\*\*Step \d+:\*\*/)) {
        stepId++;
        newSteps.push({
          id: stepId,
          type: "thinking",
          content: "Analyzing...",
          timestamp: Date.now()
        });
        continue;
      }

      // Thinking
      if (line.match(/^\*Thinking:/i) || (line.match(/^\*.*\*$/) && line.length > 5)) {
        const thinking = line.replace(/^\*Thinking:\s*/i, '').replace(/\*$/g, '').trim();
        if (newSteps.length > 0) {
          newSteps[newSteps.length - 1].content = thinking.slice(0, 50) + (thinking.length > 50 ? '...' : '');
        }
        continue;
      }

      // Tool call
      if (line.includes('📎') || line.match(/Using \*\*\w+\*\*/)) {
        const toolMatch = line.match(/Using \*\*(\w+)\*\*/);
        const paramsMatch = line.match(/\(([^)]+)\)/);
        stepId++;
        newSteps.push({
          id: stepId,
          type: "tool",
          tool: toolMatch?.[1] || "unknown",
          content: paramsMatch?.[1]?.slice(0, 30) || "",
          timestamp: Date.now()
        });
        continue;
      }

      // Result
      if (line.match(/^\s*→/)) {
        const result = line.replace(/^\s*→\s*/, '').trim();
        stepId++;
        newSteps.push({
          id: stepId,
          type: "result",
          content: result.slice(0, 50) + (result.length > 50 ? '...' : ''),
          timestamp: Date.now()
        });
      }
    }

    setSteps(newSteps);
  }, [content, startTime]);

  // Reset on new message
  const reset = useCallback(() => {
    setSteps([]);
    setStartTime(null);
  }, []);

  return { steps, startTime, reset };
}

export default AgentProgress;
