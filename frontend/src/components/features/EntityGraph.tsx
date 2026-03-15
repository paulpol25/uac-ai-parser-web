/**
 * EntityGraph — Interactive entity relationship explorer.
 *
 * Shows entities extracted from a session with neighbor lookup
 * and path-finding features. Uses a list-based layout.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Network, Search, ArrowRight, Users, Globe, FileText, Hash, Server, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { getEntities, getGraphNeighbors, getGraphStats, getKillChain } from "@/services/api";

const ENTITY_TYPE_ICONS: Record<string, React.ElementType> = {
  ip_address: Globe,
  domain: Server,
  user: Users,
  file_path: FileText,
  process: Shield,
  hash: Hash,
  email: Globe,
  url: Globe,
  service: Server,
};

const ENTITY_TYPE_COLORS: Record<string, string> = {
  ip_address: "#3b82f6",
  domain: "#06b6d4",
  user: "#f59e0b",
  file_path: "#8b5cf6",
  process: "#ef4444",
  hash: "#a855f7",
  email: "#f97316",
  url: "#10b981",
  service: "#64748b",
};

interface Entity {
  value: string;
  type: string;
  count: number;
  sources?: string[];
}

interface GraphNeighbor {
  entity: string;
  type: string;
  relationship: string;
  weight: number;
}

interface Props {
  sessionId: string;
}

export function EntityGraph({ sessionId }: Props) {
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState("");

  const { data: entitiesData } = useQuery({
    queryKey: ["entities", sessionId],
    queryFn: () => getEntities(sessionId, undefined, 200),
  });

  const { data: graphStats } = useQuery({
    queryKey: ["graph-stats", sessionId],
    queryFn: () => getGraphStats(sessionId),
  });

  const { data: killChainData } = useQuery({
    queryKey: ["kill-chain", sessionId],
    queryFn: () => getKillChain(sessionId),
  });

  const neighborsMutation = useMutation({
    mutationFn: (entityValue: string) => getGraphNeighbors(sessionId, entityValue, 2),
  });

  const entities: Entity[] = entitiesData?.entities || [];
  const entityTypes = [...new Set(entities.map((e) => e.type))].sort();

  const filtered = entities.filter((e) => {
    if (typeFilter !== "all" && e.type !== typeFilter) return false;
    if (searchText && !e.value.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  const handleEntityClick = (entity: Entity) => {
    setSelectedEntity(entity.value);
    neighborsMutation.mutate(entity.value);
  };

  const neighbors: GraphNeighbor[] = neighborsMutation.data?.neighbors || [];

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-cyan-400">{entities.length}</p>
            <p className="text-xs text-zinc-400">Total Entities</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">{entityTypes.length}</p>
            <p className="text-xs text-zinc-400">Entity Types</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-purple-400">{graphStats?.total_edges ?? "—"}</p>
            <p className="text-xs text-zinc-400">Relationships</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{killChainData?.stages?.length ?? "—"}</p>
            <p className="text-xs text-zinc-400">Kill Chain Stages</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-4">
        {/* Entity list */}
        <div className="flex-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Network className="h-4 w-4 text-cyan-400" />
                Entities
              </CardTitle>
              <div className="flex gap-2 mt-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Search entities..."
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
                  {entityTypes.map((t) => (
                    <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardContent className="max-h-[500px] overflow-auto">
              <div className="space-y-1">
                {filtered.slice(0, 100).map((entity) => {
                  const Icon = ENTITY_TYPE_ICONS[entity.type] || Network;
                  const color = ENTITY_TYPE_COLORS[entity.type] || "#64748b";
                  const isSelected = selectedEntity === entity.value;
                  return (
                    <button
                      key={`${entity.type}-${entity.value}`}
                      onClick={() => handleEntityClick(entity)}
                      className={`w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
                        isSelected
                          ? "bg-cyan-600/20 border border-cyan-500/50"
                          : "hover:bg-zinc-800 border border-transparent"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />
                      <span className="font-mono truncate flex-1">{entity.value}</span>
                      <span className="text-zinc-500 flex-shrink-0">{entity.type.replace(/_/g, " ")}</span>
                      <span className="text-zinc-600 flex-shrink-0">×{entity.count}</span>
                    </button>
                  );
                })}
                {filtered.length > 100 && (
                  <p className="text-xs text-zinc-500 text-center py-2">
                    Showing 100 of {filtered.length} entities
                  </p>
                )}
                {filtered.length === 0 && (
                  <p className="text-xs text-zinc-500 text-center py-6">No entities found</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Neighbors panel */}
        <div className="w-80 flex-shrink-0">
          <Card className="sticky top-4">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-purple-400" />
                {selectedEntity ? "Neighbors" : "Select an entity"}
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[500px] overflow-auto">
              {neighborsMutation.isPending && (
                <p className="text-xs text-zinc-400 text-center py-4">Loading neighbors...</p>
              )}
              {selectedEntity && !neighborsMutation.isPending && neighbors.length === 0 && (
                <p className="text-xs text-zinc-500 text-center py-4">No relationships found</p>
              )}
              <div className="space-y-1">
                {neighbors.map((n, i) => {
                  const Icon = ENTITY_TYPE_ICONS[n.type] || Network;
                  const color = ENTITY_TYPE_COLORS[n.type] || "#64748b";
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs bg-zinc-800/50"
                    >
                      <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono truncate">{n.entity}</div>
                        <div className="text-zinc-500 text-[10px]">{n.relationship}</div>
                      </div>
                      <span className="text-zinc-600 text-[10px]">w:{n.weight}</span>
                    </div>
                  );
                })}
              </div>

              {/* Kill chain summary */}
              {killChainData?.stages?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-zinc-700">
                  <h4 className="text-xs font-semibold text-zinc-300 mb-2">Kill Chain Analysis</h4>
                  <div className="space-y-1">
                    {killChainData.stages.map((stage: { name: string; count: number }, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-400">{stage.name}</span>
                        <span className="text-cyan-400">{stage.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
