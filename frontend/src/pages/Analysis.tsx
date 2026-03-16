import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Shield, FolderOpen } from "lucide-react";
import { MitreAttackMap } from "@/components/features/MitreAttackMap";
import { IOCDashboard } from "@/components/features/IOCDashboard";
import { SessionComparison } from "@/components/features/SessionComparison";
import { EntityGraph } from "@/components/features/EntityGraph";
import { useInvestigationStore } from "@/stores/investigationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { getInvestigation } from "@/services/api";

type AnalysisTab = "mitre" | "iocs" | "graph" | "compare";

export function Analysis() {
  const navigate = useNavigate();
  const { currentInvestigation } = useInvestigationStore();
  const { sessionId } = useSessionStore();
  const [tab, setTab] = useState<AnalysisTab>("mitre");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(sessionId);

  const { data: detail } = useQuery({
    queryKey: ["investigation", currentInvestigation?.id],
    queryFn: () => currentInvestigation ? getInvestigation(currentInvestigation.id) : null,
    enabled: !!currentInvestigation,
    refetchOnMount: "always",
  });

  const sessions = detail?.sessions?.filter(s => s.status === "ready" || s.status === "searchable") || [];

  useEffect(() => {
    if (sessions.length > 0 && (!selectedSessionId || !sessions.find(s => s.session_id === selectedSessionId))) {
      setSelectedSessionId(sessions[0].session_id);
    }
  }, [sessions.length, currentInvestigation?.id]);

  if (!currentInvestigation) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 mx-auto bg-brand-primary/10 rounded-2xl flex items-center justify-center border border-brand-primary/20">
            <Shield className="w-8 h-8 text-brand-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-semibold mb-2">Analysis</h1>
            <p className="text-text-secondary">Select an investigation to analyze.</p>
          </div>
          <button className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors" onClick={() => navigate("/investigations")}>
            <FolderOpen className="w-5 h-5" />
            Select Investigation
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-primary/10 rounded-lg flex items-center justify-center">
            <Shield className="w-4 h-4 text-brand-primary" />
          </div>
          <h1 className="text-lg font-heading font-semibold">Analysis</h1>

          {/* Tab toggle */}
          <div className="flex rounded-lg border border-border-default overflow-hidden text-xs ml-2">
            {(["mitre", "iocs", "graph", "compare"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 capitalize transition-colors ${
                  tab === t
                    ? "bg-brand-primary text-white"
                    : "bg-bg-base text-text-muted hover:text-text-primary"
                }`}
              >
                {t === "mitre" ? "MITRE ATT&CK" : t === "iocs" ? "IOCs" : t === "graph" ? "Entities" : "Compare"}
              </button>
            ))}
          </div>
        </div>

        {/* Session selector */}
        {tab !== "compare" && (
          <select
            value={selectedSessionId || ""}
            onChange={(e) => setSelectedSessionId(e.target.value)}
            className="px-2 py-1.5 bg-bg-base border border-border-default rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary/50 max-w-[200px]"
          >
            {sessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.original_filename}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "mitre" && selectedSessionId && (
          <MitreAttackMap sessionId={selectedSessionId} />
        )}
        {tab === "iocs" && currentInvestigation && (
          <IOCDashboard
            investigationId={currentInvestigation.id}
            sessionIds={sessions.map((s) => s.session_id)}
          />
        )}
        {tab === "graph" && selectedSessionId && (
          <EntityGraph sessionId={selectedSessionId} />
        )}
        {tab === "compare" && (
          <SessionComparison
            sessions={sessions.map((s) => ({
              session_id: s.session_id,
              label: s.original_filename,
            }))}
          />
        )}
      </div>
    </div>
  );
}
