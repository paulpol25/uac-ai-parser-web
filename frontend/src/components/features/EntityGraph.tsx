/**
 * EntityGraph — Entity Explorer with grouped, table, and graph views.
 *
 * Shows entities extracted from a session in three view modes:
 * - Grouped: entities organized by type in card sections with pills
 * - Table: sortable data table 
 * - Graph: static clustered graph (only moves on drag)
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Network, Search, ArrowRight, Users, Globe, FileText, Hash, Server,
  Shield, LayoutGrid, GitBranch, Copy, ChevronDown, ChevronRight,
  ArrowUpDown, Layers, X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { getEntities, getGraphNeighbors, getGraphStats, getKillChain } from "@/services/api";

const ENTITY_TYPE_ICONS: Record<string, React.ElementType> = {
  ip_address: Globe,
  ipv4: Globe,
  ipv6: Globe,
  domain: Server,
  user: Users,
  file_path: FileText,
  filepath: FileText,
  process: Shield,
  hash: Hash,
  email: Globe,
  url: Globe,
  service: Server,
  port: Network,
  cron: Shield,
  base64: Hash,
};

const ENTITY_TYPE_COLORS: Record<string, string> = {
  ip_address: "#3b82f6",
  ipv4: "#3b82f6",
  ipv6: "#60a5fa",
  domain: "#06b6d4",
  user: "#f59e0b",
  file_path: "#8b5cf6",
  filepath: "#8b5cf6",
  process: "#ef4444",
  hash: "#a855f7",
  email: "#f97316",
  url: "#10b981",
  service: "#64748b",
  port: "#14b8a6",
  cron: "#f43f5e",
  base64: "#d946ef",
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  ip_address: "IP Addresses",
  ipv4: "IPv4 Addresses",
  ipv6: "IPv6 Addresses",
  domain: "Domains",
  user: "Users",
  file_path: "File Paths",
  filepath: "File Paths",
  process: "Processes",
  hash: "Hashes",
  email: "Emails",
  url: "URLs",
  service: "Services",
  port: "Ports",
  cron: "Cron Jobs",
  base64: "Base64 Encoded",
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

/** Entity detail sidebar — shared by all views */
function EntityDetailSidebar({
  entity,
  entities,
  neighbors,
  isLoading,
  onSelectEntity,
  onClose,
}: {
  entity: string | null;
  entities: Entity[];
  neighbors: GraphNeighbor[];
  isLoading: boolean;
  onSelectEntity: (v: string) => void;
  onClose: () => void;
}) {
  const matched = entities.find((e) => e.value === entity);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (entity) {
      navigator.clipboard.writeText(entity);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (!entity) {
    return (
      <Card className="sticky top-4">
        <CardContent className="p-6 text-center">
          <ArrowRight className="h-5 w-5 text-text-muted mx-auto mb-2" />
          <p className="text-xs text-text-muted">Select an entity to view details</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="sticky top-4">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            {(() => {
              const Icon = matched ? (ENTITY_TYPE_ICONS[matched.type] || Network) : Network;
              const color = matched ? (ENTITY_TYPE_COLORS[matched.type] || "#64748b") : "#64748b";
              return <Icon className="h-4 w-4" style={{ color }} />;
            })()}
            Entity Details
          </CardTitle>
          <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded transition-colors">
            <X className="h-3.5 w-3.5 text-text-muted" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="max-h-[500px] overflow-auto space-y-3">
        {/* Entity value */}
        <div className="p-2.5 bg-bg-elevated rounded-lg">
          <div className="font-mono text-xs text-text-primary break-all leading-relaxed">{entity}</div>
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
              {matched && (
                <>
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: (ENTITY_TYPE_COLORS[matched.type] || "#64748b") + "20",
                      color: ENTITY_TYPE_COLORS[matched.type] || "#64748b",
                    }}
                  >
                    {matched.type.replace(/_/g, " ")}
                  </span>
                  <span className="text-[10px] text-text-muted">x{matched.count}</span>
                </>
              )}
            </div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary transition-colors"
            >
              <Copy className="h-3 w-3" />
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {/* Connections */}
        <div>
          <h4 className="text-[11px] font-semibold text-text-secondary mb-1.5">
            Connections ({neighbors.length})
          </h4>
          {isLoading && (
            <p className="text-xs text-text-muted text-center py-3">Loading...</p>
          )}
          {!isLoading && neighbors.length === 0 && (
            <p className="text-xs text-text-muted text-center py-3">No relationships found</p>
          )}
          <div className="space-y-1">
            {neighbors.map((n, i) => {
              const Icon = ENTITY_TYPE_ICONS[n.type] || Network;
              const color = ENTITY_TYPE_COLORS[n.type] || "#64748b";
              return (
                <button
                  key={i}
                  onClick={() => onSelectEntity(n.entity)}
                  className="w-full text-left flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs bg-bg-elevated/50 hover:bg-bg-hover transition-colors"
                >
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono truncate text-text-primary">{n.entity}</div>
                    <div className="text-text-muted text-[10px]">{n.relationship}</div>
                  </div>
                  <span className="text-text-muted text-[10px]">w:{n.weight}</span>
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Grouped view — entities organized by type in collapsible card sections */
function GroupedView({
  entities,
  entityTypes: _entityTypes,
  selectedEntity,
  onSelect,
}: {
  entities: Entity[];
  entityTypes: string[];
  selectedEntity: string | null;
  onSelect: (v: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const map = new Map<string, Entity[]>();
    for (const e of entities) {
      const list = map.get(e.type) || [];
      list.push(e);
      map.set(e.type, list);
    }
    // Sort groups by total count desc
    return [...map.entries()].sort((a, b) => {
      const sumA = a[1].reduce((s, e) => s + e.count, 0);
      const sumB = b[1].reduce((s, e) => s + e.count, 0);
      return sumB - sumA;
    });
  }, [entities]);

  const toggleCollapse = (type: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  if (grouped.length === 0) {
    return <p className="text-xs text-text-muted text-center py-8">No entities found</p>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {grouped.map(([type, items]) => {
        const Icon = ENTITY_TYPE_ICONS[type] || Network;
        const color = ENTITY_TYPE_COLORS[type] || "#64748b";
        const label = ENTITY_TYPE_LABELS[type] || type.replace(/_/g, " ");
        const isCollapsed = collapsed.has(type);
        const shown = isCollapsed ? [] : items.slice(0, 20);
        const hasMore = items.length > 20;

        return (
          <div
            key={type}
            className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden"
          >
            {/* Type header */}
            <button
              onClick={() => toggleCollapse(type)}
              className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-bg-hover/50 transition-colors"
            >
              <span
                className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: color + "18" }}
              >
                <Icon className="h-3.5 w-3.5" style={{ color }} />
              </span>
              <span className="text-sm font-medium text-text-primary flex-1 text-left">{label}</span>
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: color + "20", color }}
              >
                {items.length}
              </span>
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
              )}
            </button>

            {/* Entity pills */}
            {!isCollapsed && (
              <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                {shown.map((entity) => {
                  const isSelected = entity.value === selectedEntity;
                  return (
                    <button
                      key={entity.value}
                      onClick={() => onSelect(entity.value)}
                      title={entity.value}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono transition-all max-w-[280px] ${
                        isSelected
                          ? "ring-1 ring-offset-1 ring-offset-bg-surface"
                          : "hover:brightness-125"
                      }`}
                      style={{
                        backgroundColor: isSelected ? color + "30" : color + "12",
                        color: isSelected ? color : undefined,
                      }}
                    >
                      <span className="truncate text-text-primary"
                        style={isSelected ? { color } : undefined}
                      >
                        {entity.value}
                      </span>
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0"
                        style={{ backgroundColor: color + "20", color }}
                      >
                        {entity.count}
                      </span>
                    </button>
                  );
                })}
                {hasMore && !isCollapsed && (
                  <span className="text-[10px] text-text-muted self-center ml-1">
                    +{items.length - 20} more
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Table view — sortable data table */
function TableView({
  entities,
  selectedEntity,
  onSelect,
}: {
  entities: Entity[];
  selectedEntity: string | null;
  onSelect: (v: string) => void;
}) {
  const [sortKey, setSortKey] = useState<"value" | "type" | "count">("count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    return [...entities].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "count") cmp = a.count - b.count;
      else if (sortKey === "type") cmp = a.type.localeCompare(b.type);
      else cmp = a.value.localeCompare(b.value);
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [entities, sortKey, sortDir]);

  const toggleSort = (key: "value" | "type" | "count") => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "count" ? "desc" : "asc"); }
  };

  const SortHeader = ({ label, field }: { label: string; field: "value" | "type" | "count" }) => (
    <button
      onClick={() => toggleSort(field)}
      className="flex items-center gap-1 text-[11px] font-semibold text-text-secondary uppercase tracking-wide hover:text-text-primary transition-colors"
    >
      {label}
      <ArrowUpDown className={`h-3 w-3 ${sortKey === field ? "text-brand-primary" : "text-text-muted"}`} />
    </button>
  );

  return (
    <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_120px_80px] gap-3 px-4 py-2.5 border-b border-border-subtle bg-bg-elevated/50">
        <SortHeader label="Entity" field="value" />
        <SortHeader label="Type" field="type" />
        <SortHeader label="Count" field="count" />
      </div>
      {/* Table body */}
      <div className="max-h-[500px] overflow-auto">
        {sorted.slice(0, 100).map((entity) => {
          const color = ENTITY_TYPE_COLORS[entity.type] || "#64748b";
          const Icon = ENTITY_TYPE_ICONS[entity.type] || Network;
          const isSelected = entity.value === selectedEntity;
          return (
            <button
              key={`${entity.type}-${entity.value}`}
              onClick={() => onSelect(entity.value)}
              className={`w-full grid grid-cols-[1fr_120px_80px] gap-3 px-4 py-2 text-left border-b border-border-subtle/50 transition-colors ${
                isSelected ? "bg-brand-primary/10" : "hover:bg-bg-hover"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />
                <span className="font-mono text-xs text-text-primary truncate">{entity.value}</span>
              </div>
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded self-center w-fit"
                style={{ backgroundColor: color + "20", color }}
              >
                {entity.type.replace(/_/g, " ")}
              </span>
              <span className="text-xs text-text-muted text-right self-center tabular-nums">
                {entity.count.toLocaleString()}
              </span>
            </button>
          );
        })}
        {sorted.length > 100 && (
          <p className="text-xs text-text-muted text-center py-2">
            Showing 100 of {sorted.length} entities
          </p>
        )}
        {sorted.length === 0 && (
          <p className="text-xs text-text-muted text-center py-6">No entities found</p>
        )}
      </div>
    </div>
  );
}

/** Static clustered graph — no auto-animation, only positions once */
function StaticGraph({
  entities,
  neighbors,
  selectedEntity,
  onSelectEntity,
}: {
  entities: Entity[];
  neighbors: GraphNeighbor[];
  selectedEntity: string | null;
  onSelectEntity: (value: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<{ id: string; type: string; x: number; y: number; count: number; pinned?: boolean }[]>([]);
  const edgesRef = useRef<{ source: string; target: string; relationship: string; weight: number }[]>([]);
  const drawRef = useRef<number>(0);
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Build static layout — cluster by type
  useEffect(() => {
    const types = [...new Set(entities.map((e) => e.type))];
    const nodeMap = new Map<string, (typeof nodesRef.current)[0]>();
    const top = entities.slice(0, 80);
    const W = 800;
    const H = 600;

    // Arrange type clusters in a grid
    const cols = Math.ceil(Math.sqrt(types.length));
    const cellW = W / cols;
    const rows = Math.ceil(types.length / cols);
    const cellH = H / rows;

    types.forEach((type, ti) => {
      const col = ti % cols;
      const row = Math.floor(ti / cols);
      const cx = cellW * col + cellW / 2;
      const cy = cellH * row + cellH / 2;
      const ofType = top.filter((e) => e.type === type);
      const count = ofType.length;
      const radius = Math.min(cellW, cellH) * 0.35;

      ofType.forEach((e, ei) => {
        const angle = (ei / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
        const r = count === 1 ? 0 : radius * (0.5 + 0.5 * (ei / count));
        nodeMap.set(e.value, {
          id: e.value,
          type: e.type,
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
          count: e.count,
        });
      });
    });

    // Add neighbor nodes near selected entity
    if (selectedEntity && nodeMap.has(selectedEntity)) {
      const sel = nodeMap.get(selectedEntity)!;
      neighbors.forEach((n, i) => {
        if (!nodeMap.has(n.entity)) {
          const angle = (i / neighbors.length) * Math.PI * 2;
          const r = 40 + Math.random() * 30;
          nodeMap.set(n.entity, {
            id: n.entity,
            type: n.type,
            x: sel.x + Math.cos(angle) * r,
            y: sel.y + Math.sin(angle) * r,
            count: 1,
          });
        }
      });
    }

    nodesRef.current = Array.from(nodeMap.values());
    edgesRef.current = selectedEntity
      ? neighbors.map((n) => ({
          source: selectedEntity,
          target: n.entity,
          relationship: n.relationship,
          weight: n.weight,
        }))
      : [];
  }, [entities, neighbors, selectedEntity]);

  // Draw once (no animation loop)
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const nodes = nodesRef.current;
    const edges = edgesRef.current;

    ctx.clearRect(0, 0, W, H);

    // Draw edges
    for (const edge of edges) {
      const s = nodes.find((n) => n.id === edge.source);
      const t = nodes.find((n) => n.id === edge.target);
      if (!s || !t) continue;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = "rgba(100,180,255,0.2)";
      ctx.lineWidth = Math.min(2, 0.5 + edge.weight * 0.3);
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodes) {
      const color = ENTITY_TYPE_COLORS[node.type] || "#64748b";
      const isSelected = node.id === selectedEntity;
      const isHovered = node.id === hoveredNode;
      const r = Math.max(5, Math.min(12, 4 + node.count * 0.4));

      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = color + "33";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? color : color + "bb";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#fff" : color + "60";
      ctx.lineWidth = isSelected ? 2 : 0.5;
      ctx.stroke();

      if (isSelected || isHovered || node.count > 3 || r > 7) {
        const label = node.id.length > 20 ? node.id.slice(0, 18) + ".." : node.id;
        ctx.font = `${isSelected || isHovered ? "bold " : ""}10px sans-serif`;
        ctx.fillStyle = isSelected || isHovered ? "#fff" : "rgba(200,210,220,0.6)";
        ctx.textAlign = "center";
        ctx.fillText(label, node.x, node.y + r + 12);
      }
    }
  }, [selectedEntity, hoveredNode]);

  useEffect(() => {
    drawRef.current = requestAnimationFrame(drawCanvas);
    return () => cancelAnimationFrame(drawRef.current);
  }, [drawCanvas]);

  // Redraw on data change
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const getNodeAt = useCallback((x: number, y: number) => {
    const nodes = nodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const r = Math.max(5, Math.min(12, 4 + n.count * 0.4));
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy < (r + 4) * (r + 4)) return n;
    }
    return null;
  }, []);

  const getCanvasPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasPos(e);
    const node = getNodeAt(x, y);
    if (node) {
      dragRef.current = { nodeId: node.id, offsetX: x - node.x, offsetY: y - node.y };
      node.pinned = true;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasPos(e);
    if (dragRef.current) {
      const node = nodesRef.current.find((n) => n.id === dragRef.current!.nodeId);
      if (node) {
        node.x = x - dragRef.current.offsetX;
        node.y = y - dragRef.current.offsetY;
        drawCanvas();
      }
    } else {
      const node = getNodeAt(x, y);
      setHoveredNode(node?.id || null);
      if (canvasRef.current) canvasRef.current.style.cursor = node ? "pointer" : "default";
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      const node = nodesRef.current.find((n) => n.id === dragRef.current!.nodeId);
      if (node) node.pinned = false;
      const { x, y } = getCanvasPos(e);
      const clickNode = getNodeAt(x, y);
      if (clickNode && clickNode.id === dragRef.current.nodeId) {
        onSelectEntity(clickNode.id);
      }
      dragRef.current = null;
      drawCanvas();
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={600}
      className="w-full rounded-xl border border-border-subtle bg-bg-base"
      style={{ height: 460 }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { dragRef.current = null; setHoveredNode(null); drawCanvas(); }}
    />
  );
}

export function EntityGraph({ sessionId }: Props) {
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [viewMode, setViewMode] = useState<"grouped" | "table" | "graph">("grouped");

  const { data: entitiesData } = useQuery({
    queryKey: ["entities", sessionId],
    queryFn: () => getEntities(sessionId, undefined, 200),
  });

  const { data: graphStats } = useQuery({
    queryKey: ["graph-stats", sessionId],
    queryFn: ({ signal }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      signal?.addEventListener("abort", () => { clearTimeout(timeout); controller.abort(); });
      return getGraphStats(sessionId, controller.signal)
        .then(r => { clearTimeout(timeout); return r; })
        .catch(() => null);
    },
    retry: false,
    staleTime: 300000,
  });

  const { data: killChainData } = useQuery({
    queryKey: ["kill-chain", sessionId],
    queryFn: ({ signal }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      signal?.addEventListener("abort", () => { clearTimeout(timeout); controller.abort(); });
      return getKillChain(sessionId, controller.signal)
        .then(r => { clearTimeout(timeout); return r; })
        .catch(() => null);
    },
    retry: false,
    staleTime: 300000,
  });

  const neighborsMutation = useMutation({
    mutationFn: (entityValue: string) => getGraphNeighbors(sessionId, entityValue, 2),
  });

  const entities: Entity[] = (entitiesData?.entities || []).map((e: Record<string, unknown>) => ({
    ...e,
    count: (e.occurrences as number) || (e.count as number) || 1,
  })) as Entity[];
  const entityTypes = [...new Set(entities.map((e) => e.type))].sort();

  const filtered = entities.filter((e) => {
    if (typeFilter !== "all" && e.type !== typeFilter) return false;
    if (searchText && !e.value.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  const handleEntityClick = (entityValue: string) => {
    setSelectedEntity(entityValue);
    neighborsMutation.mutate(entityValue);
  };

  const neighbors: GraphNeighbor[] = (neighborsMutation.data?.neighbors || []).map(
    (n: Record<string, unknown>) => ({
      entity: (n.entity_value as string) || (n.entity as string) || "",
      type: (n.entity_type as string) || (n.type as string) || "",
      relationship: (n.relationship as string) || "",
      weight: (n.confidence as number) || (n.weight as number) || 1,
    })
  );

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { value: entities.length, label: "Total Entities", color: "text-brand-primary", icon: <Layers className="h-4 w-4 text-brand-primary/60" /> },
          { value: entityTypes.length, label: "Entity Types", color: "text-blue-400", icon: <LayoutGrid className="h-4 w-4 text-blue-400/60" /> },
          { value: graphStats?.total_edges ?? "—", label: "Relationships", color: "text-purple-400", icon: <GitBranch className="h-4 w-4 text-purple-400/60" /> },
          { value: killChainData?.stages?.length ?? "—", label: "Kill Chain Stages", color: "text-amber-400", icon: <Shield className="h-4 w-4 text-amber-400/60" /> },
        ].map((stat, i) => (
          <Card key={i}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-bg-elevated flex items-center justify-center flex-shrink-0">
                {stat.icon}
              </div>
              <div>
                <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                <p className="text-[10px] text-text-muted">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* View toggle + Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border-default overflow-hidden text-xs">
          {([
            { key: "grouped" as const, icon: <LayoutGrid className="h-3 w-3" />, label: "Grouped" },
            { key: "table" as const, icon: <ArrowUpDown className="h-3 w-3" />, label: "Table" },
            { key: "graph" as const, icon: <GitBranch className="h-3 w-3" />, label: "Graph" },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setViewMode(tab.key)}
              className={`flex items-center gap-1 px-3 py-1.5 transition-colors ${
                viewMode === tab.key
                  ? "bg-brand-primary text-white"
                  : "bg-bg-elevated text-text-muted hover:text-text-primary"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
          <input
            type="text"
            placeholder="Search entities..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full rounded-lg border border-border-default bg-bg-elevated pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted"
          />
        </div>

        <CustomSelect
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: "all", label: "All types" },
            ...entityTypes.map((t) => ({ value: t, label: t.replace(/_/g, " ") })),
          ]}
        />

        {/* Type legend */}
        <div className="flex flex-wrap gap-2 ml-auto">
          {entityTypes.slice(0, 6).map((t) => (
            <span key={t} className="flex items-center gap-1 text-[10px] text-text-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ENTITY_TYPE_COLORS[t] || "#64748b" }} />
              {t.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      </div>

      {/* Main content + sidebar */}
      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          {viewMode === "grouped" && (
            <GroupedView
              entities={filtered}
              entityTypes={entityTypes}
              selectedEntity={selectedEntity}
              onSelect={handleEntityClick}
            />
          )}
          {viewMode === "table" && (
            <TableView
              entities={filtered}
              selectedEntity={selectedEntity}
              onSelect={handleEntityClick}
            />
          )}
          {viewMode === "graph" && (
            <StaticGraph
              entities={filtered}
              neighbors={neighbors}
              selectedEntity={selectedEntity}
              onSelectEntity={handleEntityClick}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="w-72 flex-shrink-0">
          <EntityDetailSidebar
            entity={selectedEntity}
            entities={entities}
            neighbors={neighbors}
            isLoading={neighborsMutation.isPending}
            onSelectEntity={handleEntityClick}
            onClose={() => setSelectedEntity(null)}
          />
        </div>
      </div>

      {/* Kill chain at bottom */}
      {killChainData?.stages?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-400" />
              Kill Chain Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {killChainData.stages.map((stage: { name: string; count: number }, i: number) => (
                <div key={i} className="flex items-center flex-shrink-0">
                  <div className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-center min-w-[80px]">
                    <p className="text-xs font-medium text-text-primary">{stage.name}</p>
                    <p className="text-lg font-bold text-brand-primary">{stage.count}</p>
                  </div>
                  {i < killChainData.stages.length - 1 && (
                    <ArrowRight className="h-3.5 w-3.5 text-text-muted mx-1 flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
