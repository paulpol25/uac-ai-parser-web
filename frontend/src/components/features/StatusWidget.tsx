/**
 * StatusWidget - Shows current system status at a glance
 */
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Server,
  Brain,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { getHealth, getFullConfig } from "@/services/api";

type Status = "online" | "offline" | "warning" | "loading";

interface StatusIndicatorProps {
  label: string;
  status: Status;
  detail?: string;
  icon: React.ElementType;
}

function StatusIndicator({ label, status, detail, icon: Icon }: StatusIndicatorProps) {
  const statusConfig = {
    online: {
      color: "text-green-500",
      bg: "bg-green-500/10",
      StatusIcon: CheckCircle2,
    },
    offline: {
      color: "text-red-500",
      bg: "bg-red-500/10",
      StatusIcon: XCircle,
    },
    warning: {
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      StatusIcon: AlertCircle,
    },
    loading: {
      color: "text-text-muted",
      bg: "bg-bg-elevated",
      StatusIcon: RefreshCw,
    },
  };

  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-lg ${config.bg}`}>
        <Icon className={`w-4 h-4 ${config.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {detail && (
          <p className="text-xs text-text-muted truncate">{detail}</p>
        )}
      </div>
      <config.StatusIcon
        className={`w-4 h-4 ${config.color} ${
          status === "loading" ? "animate-spin" : ""
        }`}
      />
    </div>
  );
}

export function StatusWidget() {
  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    staleTime: 30000,
    refetchInterval: 60000, // Check every minute
  });

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["full-config"],
    queryFn: getFullConfig,
    staleTime: 60000,
  });

  const getBackendStatus = (): Status => {
    if (healthLoading) return "loading";
    return health?.status === "healthy" ? "online" : "offline";
  };

  const getLLMStatus = (): { status: Status; detail: string } => {
    if (configLoading) return { status: "loading", detail: "" };
    if (!config) return { status: "offline", detail: "Not configured" };

    const activeProvider = config.active_provider || "ollama";
    const providerConfig = config.providers?.[activeProvider];

    if (!providerConfig) {
      return { status: "warning", detail: `${activeProvider} not configured` };
    }

    // For cloud providers, check if API key is set
    if (activeProvider !== "ollama" && !providerConfig.api_key) {
      return { status: "warning", detail: `${activeProvider} - No API key` };
    }

    const model = providerConfig.model || "default";
    return {
      status: "online",
      detail: `${activeProvider} - ${model}`,
    };
  };

  const llmInfo = getLLMStatus();

  return (
    <Card>
      <CardContent className="space-y-3">
        <StatusIndicator
          label="Backend API"
          status={getBackendStatus()}
          detail={health?.status === "healthy" ? "Connected" : "Disconnected"}
          icon={Server}
        />
        <StatusIndicator
          label="LLM Provider"
          status={llmInfo.status}
          detail={llmInfo.detail}
          icon={Brain}
        />
        <StatusIndicator
          label="Embeddings"
          status={config?.active_embedding_provider ? "online" : "warning"}
          detail={config?.active_embedding_provider || "Using default"}
          icon={Activity}
        />
      </CardContent>
    </Card>
  );
}

export default StatusWidget;
