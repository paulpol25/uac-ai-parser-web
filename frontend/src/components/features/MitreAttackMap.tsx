/**
 * MitreAttackMap — MITRE ATT&CK matrix heatmap.
 *
 * Displays detected techniques organized by tactic column.
 * Color-coded by confidence, click to expand inline detail with evidence.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, ExternalLink, ChevronDown, ChevronRight, Target, BarChart3, FileText, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { getMitreSummary, mitreScan } from "@/services/api";
import type { MitreSummary, MitreTechnique } from "@/services/api";

const TACTIC_ORDER = [
  "initial-access",
  "execution",
  "persistence",
  "privilege-escalation",
  "defense-evasion",
  "credential-access",
  "discovery",
  "lateral-movement",
  "collection",
  "exfiltration",
  "command-and-control",
  "impact",
];

const TACTIC_LABELS: Record<string, string> = {
  "initial-access": "Initial Access",
  execution: "Execution",
  persistence: "Persistence",
  "privilege-escalation": "Privilege Escalation",
  "defense-evasion": "Defense Evasion",
  "credential-access": "Credential Access",
  discovery: "Discovery",
  "lateral-movement": "Lateral Movement",
  collection: "Collection",
  exfiltration: "Exfiltration",
  "command-and-control": "Command & Control",
  impact: "Impact",
};

function confidenceColor(c: number): string {
  if (c >= 0.8) return "bg-red-600/80 text-white";
  if (c >= 0.6) return "bg-orange-500/70 text-white";
  if (c >= 0.4) return "bg-yellow-500/60 text-black";
  return "bg-brand-primary/30 text-brand-primary";
}

function confidenceLabel(c: number): string {
  if (c >= 0.8) return "High";
  if (c >= 0.6) return "Medium-High";
  if (c >= 0.4) return "Medium";
  return "Low";
}

function confidenceBadgeColor(c: number): string {
  if (c >= 0.8) return "bg-red-500/20 text-red-400";
  if (c >= 0.6) return "bg-orange-500/20 text-orange-400";
  if (c >= 0.4) return "bg-yellow-500/20 text-yellow-400";
  return "bg-brand-primary/20 text-brand-primary";
}

function confidenceBarColor(c: number): string {
  if (c >= 0.8) return "bg-red-500";
  if (c >= 0.6) return "bg-orange-500";
  if (c >= 0.4) return "bg-yellow-500";
  return "bg-brand-primary";
}

interface Props {
  sessionId: string;
}

export function MitreAttackMap({ sessionId }: Props) {
  const [expandedTech, setExpandedTech] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const { data, isLoading, refetch } = useQuery<MitreSummary>({
    queryKey: ["mitre-summary", sessionId],
    queryFn: () => getMitreSummary(sessionId),
  });

  const handleScan = async () => {
    setIsScanning(true);
    try {
      await mitreScan(sessionId);
      await refetch();
    } finally {
      setIsScanning(false);
    }
  };

  const toggleTech = (key: string) => {
    setExpandedTech((prev) => (prev === key ? null : key));
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-text-muted">Loading MITRE mappings...</CardContent>
      </Card>
    );
  }

  const tactics = data?.tactics || {};
  const total = data?.total_techniques || 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-brand-primary" />
          MITRE ATT&CK Coverage
          {!isScanning && (
            <span className="ml-2 text-sm font-normal text-text-muted">
              {total} technique{total !== 1 ? "s" : ""} detected
            </span>
          )}
        </CardTitle>
        <button
          onClick={handleScan}
          disabled={isScanning}
          className="rounded bg-brand-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {isScanning && <Loader2 className="h-3 w-3 animate-spin" />}
          {isScanning ? "Scanning..." : "Re-scan"}
        </button>
      </CardHeader>
      <CardContent>
        {isScanning ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
            <p className="text-sm text-text-muted">Scanning forensic artifacts for MITRE ATT&CK techniques...</p>
          </div>
        ) : total === 0 ? (
          <div className="text-center py-8">
            <p className="text-text-muted mb-4">No MITRE techniques detected yet.</p>
            <button
              onClick={handleScan}
              className="rounded bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Run MITRE Scan
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            {TACTIC_ORDER.map((tactic) => {
              const techniques = tactics[tactic];
              if (!techniques?.length) return null;

              return (
                <div key={tactic} className="flex flex-col gap-1">
                  <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider pb-1 border-b border-border-subtle">
                    {TACTIC_LABELS[tactic] || tactic}
                    <span className="ml-1 text-text-muted">({techniques.length})</span>
                  </div>
                  {techniques.map((tech) => {
                    const key = `${tech.technique_id}:${tactic}`;
                    const isExpanded = expandedTech === key;

                    return (
                      <div key={key}>
                        <button
                          onClick={() => toggleTech(key)}
                          className={`w-full text-left rounded px-2 py-1.5 text-xs transition-all ${confidenceColor(tech.confidence)} hover:opacity-90 hover:scale-[1.02] flex items-center gap-1`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-[10px] opacity-80">{tech.technique_id}</div>
                            <div className="truncate font-medium">{tech.technique_name}</div>
                          </div>
                          {isExpanded ? <ChevronDown className="h-3 w-3 shrink-0 opacity-70" /> : <ChevronRight className="h-3 w-3 shrink-0 opacity-70" />}
                        </button>

                        {/* Inline detail panel */}
                        {isExpanded && (
                          <InlineDetail tech={tech} tactic={tactic} />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Inline expandable detail ---------- */

function InlineDetail({ tech, tactic }: { tech: MitreTechnique; tactic: string }) {
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  return (
    <div className="mt-1 rounded-lg bg-bg-elevated border border-border-subtle p-3 space-y-2.5 text-xs">
      {/* Tactic + confidence badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1 text-text-muted">
          <Target className="h-3 w-3" />
          {TACTIC_LABELS[tactic] || tactic}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${confidenceBadgeColor(tech.confidence)}`}>
          {confidenceLabel(tech.confidence)} ({Math.round(tech.confidence * 100)}%)
        </span>
      </div>

      {/* Confidence bar */}
      <div>
        <div className="flex items-center justify-between text-[10px] mb-0.5">
          <span className="flex items-center gap-1 text-text-muted">
            <BarChart3 className="h-2.5 w-2.5" /> Confidence
          </span>
          <span className="font-medium text-text-primary">{Math.round(tech.confidence * 100)}%</span>
        </div>
        <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${confidenceBarColor(tech.confidence)}`}
            style={{ width: `${tech.confidence * 100}%` }}
          />
        </div>
      </div>

      {/* Evidence location */}
      {(tech.source_file || tech.evidence_chunk_id) && (
        <div className="flex items-start gap-1.5 text-text-muted">
          <FileText className="h-3 w-3 shrink-0 mt-0.5" />
          <span className="break-all">Source: <span className="text-text-secondary font-mono">{tech.source_file || tech.evidence_chunk_id}</span></span>
        </div>
      )}

      {/* Evidence snippet */}
      {tech.evidence_snippet && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-[10px] font-medium text-text-muted">Evidence</h4>
            {tech.evidence_snippet.length > 200 && (
              <button
                onClick={() => setEvidenceExpanded(!evidenceExpanded)}
                className="text-[10px] text-brand-primary hover:underline"
              >
                {evidenceExpanded ? "Collapse" : "Show all"}
              </button>
            )}
          </div>
          <div className={`bg-bg-base rounded p-2 text-[11px] text-text-secondary font-mono whitespace-pre-wrap break-all overflow-auto border border-border-subtle ${evidenceExpanded ? "" : "max-h-32"}`}>
            {tech.evidence_snippet}
          </div>
        </div>
      )}

      {/* MITRE link */}
      <a
        href={`https://attack.mitre.org/techniques/${tech.technique_id.replace(".", "/")}/`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-brand-primary hover:underline"
      >
        <ExternalLink className="h-3 w-3" />
        View on MITRE ATT&CK
      </a>
    </div>
  );
}
