/**
 * SessionComparison — Side-by-side diff of two parsed sessions.
 *
 * Compares users, processes, network, services, and file hashes
 * using the backend comparison endpoint.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { GitCompare, Plus, Minus, Equal, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { compareSessions } from "@/services/api";

interface DimensionDiff {
  added: string[];
  removed: string[];
  common: string[];
}

interface SessionOption {
  session_id: string;
  label: string;
}

interface Props {
  sessions: SessionOption[];
}

function DimensionSection({
  name,
  diff,
  summary,
}: {
  name: string;
  diff: DimensionDiff;
  summary: { added: number; removed: number; common: number };
}) {
  const [expanded, setExpanded] = useState(false);
  const total = summary.added + summary.removed + summary.common;

  return (
    <div className="border border-zinc-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-800/50 hover:bg-zinc-800 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-zinc-400 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-zinc-400 shrink-0" />
        )}
        <span className="text-sm font-medium text-zinc-200 capitalize flex-1">{name}</span>
        <div className="flex items-center gap-3 text-xs">
          {summary.added > 0 && (
            <span className="flex items-center gap-1 text-green-400">
              <Plus className="h-3 w-3" />
              {summary.added}
            </span>
          )}
          {summary.removed > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <Minus className="h-3 w-3" />
              {summary.removed}
            </span>
          )}
          <span className="flex items-center gap-1 text-zinc-500">
            <Equal className="h-3 w-3" />
            {summary.common}
          </span>
          <span className="text-zinc-600">{total} total</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-2 max-h-[300px] overflow-auto">
          {diff.added.length > 0 && (
            <div>
              <p className="text-[10px] text-green-400 uppercase tracking-wider mb-1">
                Added (only in Session B)
              </p>
              {diff.added.map((v, i) => (
                <p key={i} className="font-mono text-xs text-green-300 pl-3 border-l-2 border-green-600/40 py-0.5">
                  + {v}
                </p>
              ))}
            </div>
          )}
          {diff.removed.length > 0 && (
            <div>
              <p className="text-[10px] text-red-400 uppercase tracking-wider mb-1">
                Removed (only in Session A)
              </p>
              {diff.removed.map((v, i) => (
                <p key={i} className="font-mono text-xs text-red-300 pl-3 border-l-2 border-red-600/40 py-0.5">
                  - {v}
                </p>
              ))}
            </div>
          )}
          {diff.common.length > 0 && (
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                Common (in both sessions)
              </p>
              {diff.common.slice(0, 50).map((v, i) => (
                <p key={i} className="font-mono text-xs text-zinc-500 pl-3 border-l-2 border-zinc-700 py-0.5">
                  {v}
                </p>
              ))}
              {diff.common.length > 50 && (
                <p className="text-xs text-zinc-600 pl-3">...and {diff.common.length - 50} more</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SessionComparison({ sessions }: Props) {
  const [sessionA, setSessionA] = useState<string>("");
  const [sessionB, setSessionB] = useState<string>("");

  const mutation = useMutation({
    mutationFn: () => compareSessions(sessionA, sessionB),
  });

  const canCompare = sessionA && sessionB && sessionA !== sessionB;

  return (
    <div className="space-y-4">
      {/* Session selectors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <GitCompare className="h-4 w-4 text-cyan-400" />
            Compare Sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-zinc-400 mb-1 block">Session A (baseline)</label>
              <select
                value={sessionA}
                onChange={(e) => setSessionA(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
              >
                <option value="">Select session...</option>
                {sessions.map((s) => (
                  <option key={s.session_id} value={s.session_id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-zinc-400 mb-1 block">Session B (compare)</label>
              <select
                value={sessionB}
                onChange={(e) => setSessionB(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
              >
                <option value="">Select session...</option>
                {sessions.map((s) => (
                  <option key={s.session_id} value={s.session_id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => mutation.mutate()}
              disabled={!canCompare || mutation.isPending}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-xs text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {mutation.isPending ? "Comparing..." : "Compare"}
            </button>
          </div>
          {sessionA && sessionB && sessionA === sessionB && (
            <p className="text-xs text-amber-400 mt-2">Please select two different sessions.</p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {mutation.data && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="flex flex-wrap gap-3">
            {Object.entries(mutation.data.summary as Record<string, { added: number; removed: number; common: number }>).map(([dim, stats]) => (
              <div
                key={dim}
                className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2"
              >
                <span className="text-xs font-medium text-zinc-300 capitalize">{dim}</span>
                <span className="text-xs text-green-400">+{stats.added}</span>
                <span className="text-xs text-red-400">-{stats.removed}</span>
                <span className="text-xs text-zinc-500">={stats.common}</span>
              </div>
            ))}
          </div>

          {/* Dimension details */}
          {Object.entries(mutation.data.dimensions as Record<string, DimensionDiff>).map(([dim, diff]) => (
            <DimensionSection
              key={dim}
              name={dim}
              diff={diff}
              summary={mutation.data!.summary[dim]}
            />
          ))}
        </div>
      )}

      {mutation.isError && (
        <p className="text-red-400 text-sm text-center py-4">
          Comparison failed: {(mutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
