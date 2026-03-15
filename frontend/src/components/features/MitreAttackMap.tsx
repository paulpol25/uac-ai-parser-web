/**
 * MitreAttackMap — MITRE ATT&CK matrix heatmap.
 *
 * Displays detected techniques organized by tactic column.
 * Color-coded by confidence, click to see evidence.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { getMitreSummary, mitreScan } from "@/services/api";
import type { MitreSummary } from "@/services/api";

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
  return "bg-cyan-600/40 text-white";
}

interface Props {
  sessionId: string;
}

export function MitreAttackMap({ sessionId }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<MitreSummary>({
    queryKey: ["mitre-summary", sessionId],
    queryFn: () => getMitreSummary(sessionId),
  });

  const handleScan = async () => {
    await mitreScan(sessionId);
    refetch();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-zinc-400">Loading MITRE mappings...</CardContent>
      </Card>
    );
  }

  const tactics = data?.tactics || {};
  const total = data?.total_techniques || 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-cyan-400" />
          MITRE ATT&CK Coverage
          <span className="ml-2 text-sm font-normal text-zinc-400">
            {total} technique{total !== 1 ? "s" : ""} detected
          </span>
        </CardTitle>
        <button
          onClick={handleScan}
          className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 transition-colors"
        >
          Re-scan
        </button>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="text-center py-8">
            <p className="text-zinc-400 mb-4">No MITRE techniques detected yet.</p>
            <button
              onClick={handleScan}
              className="rounded bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
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
                  <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wider pb-1 border-b border-zinc-700">
                    {TACTIC_LABELS[tactic] || tactic}
                    <span className="ml-1 text-zinc-500">({techniques.length})</span>
                  </div>
                  {techniques.map((tech) => (
                    <button
                      key={tech.technique_id}
                      onClick={() =>
                        setExpanded(
                          expanded === tech.technique_id ? null : tech.technique_id
                        )
                      }
                      className={`text-left rounded px-2 py-1.5 text-xs transition-all ${confidenceColor(tech.confidence)} hover:opacity-90`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px]">{tech.technique_id}</span>
                        {expanded === tech.technique_id ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </div>
                      <div className="truncate">{tech.technique_name}</div>
                      {expanded === tech.technique_id && tech.evidence_snippet && (
                        <div className="mt-1 p-1 bg-black/30 rounded text-[10px] break-all whitespace-pre-wrap max-h-24 overflow-auto">
                          {tech.evidence_snippet}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
