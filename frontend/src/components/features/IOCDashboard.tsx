/**
 * IOCDashboard — Cross-session IOC correlation view.
 *
 * Shows IOCs extracted from the current investigation with cross-session
 * highlighting and type-based grouping.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, RefreshCw, Search, AlertTriangle, Globe, Server, Hash, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { getIOCSummary, getIOCCorrelation, iocExtract, searchIOCs } from "@/services/api";

const IOC_TYPE_ICONS: Record<string, React.ElementType> = {
  ip: Globe,
  domain: Server,
  hash_md5: Hash,
  hash_sha1: Hash,
  hash_sha256: Hash,
  email: Mail,
  url: Globe,
};

const IOC_TYPE_COLORS: Record<string, string> = {
  ip: "#3b82f6",
  domain: "#06b6d4",
  hash_md5: "#8b5cf6",
  hash_sha1: "#a855f7",
  hash_sha256: "#c084fc",
  email: "#f59e0b",
  url: "#10b981",
};

interface Props {
  investigationId: number;
  sessionIds: string[];
}

export function IOCDashboard({ investigationId, sessionIds }: Props) {
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | "all">("all");

  const { data: summary } = useQuery({
    queryKey: ["ioc-summary", investigationId],
    queryFn: () => getIOCSummary(investigationId),
  });

  const { data: correlation, isLoading } = useQuery({
    queryKey: ["ioc-correlation", investigationId],
    queryFn: () => getIOCCorrelation(investigationId),
  });

  const { data: searchResults } = useQuery({
    queryKey: ["ioc-search", investigationId, searchText],
    queryFn: () => searchIOCs(investigationId, searchText),
    enabled: searchText.length >= 3,
  });

  const extractMutation = useMutation({
    mutationFn: (sessionId: string) => iocExtract(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ioc-summary", investigationId] });
      queryClient.invalidateQueries({ queryKey: ["ioc-correlation", investigationId] });
    },
  });

  const extractAll = () => {
    sessionIds.forEach((sid) => extractMutation.mutate(sid));
  };

  const allIOCs = useMemo(() => {
    if (searchText.length >= 3 && searchResults?.results) return searchResults.results;
    if (!correlation) return [];
    const raw = [...(correlation.cross_session_iocs || []), ...(correlation.single_session_iocs || [])];
    // Normalize: backend returns "type" but component expects "ioc_type"
    return raw.map((ioc) => ({
      ...ioc,
      ioc_type: ioc.ioc_type ?? ioc.type,
    }));
  }, [correlation, searchResults, searchText]);

  const filteredIOCs = useMemo(() => {
    if (typeFilter === "all") return allIOCs;
    return allIOCs.filter((ioc) => ioc.ioc_type === typeFilter);
  }, [allIOCs, typeFilter]);

  const iocTypes = useMemo(
    () => [...new Set(allIOCs.map((i) => i.ioc_type))].sort(),
    [allIOCs]
  );

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-cyan-400">{summary?.total_iocs ?? "—"}</p>
            <p className="text-xs text-zinc-400">Total IOCs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{summary?.multi_session ?? "—"}</p>
            <p className="text-xs text-zinc-400">Cross-Session</p>
          </CardContent>
        </Card>
        {Object.entries(summary?.by_type ?? {})
          .slice(0, 2)
          .map(([type, count]) => (
            <Card key={type}>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold" style={{ color: IOC_TYPE_COLORS[type] || "#64748b" }}>
                  {count}
                </p>
                <p className="text-xs text-zinc-400">{type.replace(/_/g, " ").toUpperCase()}</p>
              </CardContent>
            </Card>
          ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={extractAll}
          disabled={extractMutation.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${extractMutation.isPending ? "animate-spin" : ""}`} />
          {extractMutation.isPending ? "Extracting..." : "Extract IOCs"}
        </button>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search IOCs (min 3 chars)..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200"
        >
          <option value="all">All types</option>
          {iocTypes.map((t) => (
            <option key={t} value={t}>
              {(t || "").replace(/_/g, " ")}
            </option>
          ))}
        </select>

        <span className="text-xs text-zinc-500 ml-auto">{filteredIOCs.length} results</span>
      </div>

      {/* Cross-session highlight */}
      {correlation && (correlation.cross_session_iocs?.length ?? 0) > 0 && searchText.length < 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Cross-Session IOCs
              <span className="font-normal text-zinc-400">
                — Found in multiple sessions
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {correlation.cross_session_iocs.slice(0, 20).map((ioc) => {
                const iocType = ioc.ioc_type ?? ioc.type;
                const Icon = IOC_TYPE_ICONS[iocType] || Fingerprint;
                return (
                  <div
                    key={ioc.id}
                    className="flex items-center gap-3 rounded-lg border border-amber-600/20 bg-amber-600/5 px-3 py-2"
                  >
                    <Icon className="h-4 w-4 text-amber-400 shrink-0" />
                    <span className="font-mono text-xs text-zinc-200 flex-1 truncate">{ioc.value}</span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: (IOC_TYPE_COLORS[iocType] || "#64748b") + "22",
                        color: IOC_TYPE_COLORS[iocType] || "#64748b",
                      }}
                    >
                      {(iocType || "").replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] text-amber-400 font-medium">
                      {ioc.session_count} sessions
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* IOC table */}
      {isLoading ? (
        <p className="text-zinc-400 text-sm text-center py-8">Loading IOCs...</p>
      ) : filteredIOCs.length === 0 ? (
        <p className="text-zinc-500 text-sm text-center py-8">
          No IOCs found. Click "Extract IOCs" to scan sessions.
        </p>
      ) : (
        <div className="max-h-[500px] overflow-auto rounded-lg border border-zinc-700">
          <table className="w-full text-xs text-left">
            <thead className="bg-zinc-800 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-zinc-400">Type</th>
                <th className="px-3 py-2 text-zinc-400">Value</th>
                <th className="px-3 py-2 text-zinc-400">First Seen</th>
                <th className="px-3 py-2 text-zinc-400">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {filteredIOCs.slice(0, 500).map((ioc) => {
                const iocType = ioc.ioc_type || "";
                const Icon = IOC_TYPE_ICONS[iocType] || Fingerprint;
                const isMulti = ioc.session_count > 1;
                return (
                  <tr
                    key={ioc.id}
                    className={`border-t border-zinc-800 hover:bg-zinc-800/50 ${isMulti ? "bg-amber-600/5" : ""}`}
                  >
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5" style={{ color: IOC_TYPE_COLORS[iocType] || "#64748b" }} />
                        <span className="text-[10px] text-zinc-400">{iocType.replace(/_/g, " ")}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-zinc-200 truncate max-w-[300px]">{ioc.value}</td>
                    <td className="px-3 py-1.5 text-zinc-500">{ioc.first_seen?.slice(0, 19) || "—"}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          isMulti ? "bg-amber-600/20 text-amber-400" : "bg-zinc-700 text-zinc-400"
                        }`}
                      >
                        {ioc.session_count}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
