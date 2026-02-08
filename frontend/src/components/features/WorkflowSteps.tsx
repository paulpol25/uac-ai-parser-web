/**
 * WorkflowSteps - Visual workflow guidance showing analysis steps
 * 
 * Helps users understand the analysis workflow: Investigation → Upload → Parse → Query
 */
import { useNavigate } from "react-router-dom";
import {
  FolderOpen,
  Upload,
  Database,
  Sparkles,
  Check,
  ChevronRight,
} from "lucide-react";

type StepStatus = "completed" | "current" | "pending";

interface WorkflowStep {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  status: StepStatus;
  action?: () => void;
}

interface WorkflowStepsProps {
  hasInvestigation: boolean;
  hasSession: boolean;
  hasSummary: boolean;
  onUploadClick?: () => void;
}

export function WorkflowSteps({
  hasInvestigation,
  hasSession,
  hasSummary,
  onUploadClick,
}: WorkflowStepsProps) {
  const navigate = useNavigate();

  const steps: WorkflowStep[] = [
    {
      id: "investigation",
      label: "Select Investigation",
      description: "Create or select a case",
      icon: FolderOpen,
      status: hasInvestigation ? "completed" : "current",
      action: () => navigate("/investigations"),
    },
    {
      id: "upload",
      label: "Upload Data",
      description: "Upload UAC output file",
      icon: Upload,
      status: hasInvestigation
        ? hasSession
          ? "completed"
          : "current"
        : "pending",
      action: onUploadClick,
    },
    {
      id: "parse",
      label: "Parse Artifacts",
      description: "Automatic indexing",
      icon: Database,
      status: hasSession
        ? hasSummary
          ? "completed"
          : "current"
        : "pending",
    },
    {
      id: "query",
      label: "AI Analysis",
      description: "Ask questions about data",
      icon: Sparkles,
      status: hasSummary ? "current" : "pending",
      action: () => navigate("/query"),
    },
  ];

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-4">
      <h3 className="text-sm font-medium text-text-primary mb-4">
        Analysis Workflow
      </h3>
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center flex-1">
            <StepItem step={step} />
            {index < steps.length - 1 && (
              <div className="flex-1 mx-2">
                <ChevronRight
                  className={`w-5 h-5 mx-auto ${
                    step.status === "completed"
                      ? "text-brand-primary"
                      : "text-border-default"
                  }`}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StepItem({ step }: { step: WorkflowStep }) {
  const Icon = step.icon;
  const isClickable = step.action && step.status !== "pending";

  const statusStyles = {
    completed: {
      container: "bg-brand-primary/10 border-brand-primary",
      icon: "text-brand-primary",
      label: "text-text-primary",
      desc: "text-text-muted",
    },
    current: {
      container: "bg-brand-primary/5 border-brand-primary animate-pulse",
      icon: "text-brand-primary",
      label: "text-text-primary font-medium",
      desc: "text-text-secondary",
    },
    pending: {
      container: "bg-bg-elevated border-border-default",
      icon: "text-text-muted",
      label: "text-text-muted",
      desc: "text-text-muted",
    },
  };

  const styles = statusStyles[step.status];

  const content = (
    <div className="flex flex-col items-center text-center">
      <div
        className={`w-10 h-10 rounded-full border-2 flex items-center justify-center mb-2 transition-colors ${styles.container}`}
      >
        {step.status === "completed" ? (
          <Check className="w-5 h-5 text-brand-primary" />
        ) : (
          <Icon className={`w-5 h-5 ${styles.icon}`} />
        )}
      </div>
      <p className={`text-xs ${styles.label}`}>{step.label}</p>
      <p className={`text-[10px] ${styles.desc}`}>{step.description}</p>
    </div>
  );

  if (isClickable) {
    return (
      <button
        onClick={step.action}
        className="hover:scale-105 transition-transform cursor-pointer"
        title={`Go to ${step.label}`}
      >
        {content}
      </button>
    );
  }

  return content;
}

export default WorkflowSteps;
