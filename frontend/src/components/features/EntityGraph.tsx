/**
 * EntityGraph — Interactive entity relationship explorer.
 *
 * Shows entities extracted from a session with neighbor lookup
 * and path-finding features. Includes a visual force-directed graph view.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Network, Search, ArrowRight, Users, Globe, FileText, Hash, Server, Shield, LayoutGrid, GitBranch } from "lucide-react";
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

// Simple force-directed graph node
interface GraphNode {
  id: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  count: number;
  pinned?: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  weight: number;
}

interface Props {
  sessionId: string;
}

/** Canvas-based force-directed graph visualization */
function ForceGraph({
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
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animRef = useRef<number>(0);
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Build graph data from entities + neighbors
  useEffect(() => {
    const nodeMap = new Map<string, GraphNode>();
    const cx = 400;
    const cy = 300;

    // Add main entities (top 60 by count)
    const top = entities.slice(0, 60);
    top.forEach((e, i) => {
      const angle = (i / top.length) * Math.PI * 2;
      const r = 120 + Math.random() * 100;
      nodeMap.set(e.value, {
        id: e.value,
        type: e.type,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        count: e.count,
      });
    });

    // Add neighbor nodes
    neighbors.forEach((n) => {
      if (!nodeMap.has(n.entity)) {
        const angle = Math.random() * Math.PI * 2;
        const r = 200 + Math.random() * 80;
        nodeMap.set(n.entity, {
          id: n.entity,
          type: n.type,
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
          vx: 0,
          vy: 0,
          count: 1,
        });
      }
    });

    nodesRef.current = Array.from(nodeMap.values());

    // Build edges from neighbors
    if (selectedEntity) {
      edgesRef.current = neighbors.map((n) => ({
        source: selectedEntity,
        target: n.entity,
        relationship: n.relationship,
        weight: n.weight,
      }));
    } else {
      edgesRef.current = [];
    }
  }, [entities, neighbors, selectedEntity]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;
    const W = canvas.width;
    const H = canvas.height;

    const tick = () => {
      if (!running) return;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;

      // Simple force simulation
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].pinned) continue;
        // Center gravity
        nodes[i].vx += (W / 2 - nodes[i].x) * 0.001;
        nodes[i].vy += (H / 2 - nodes[i].y) * 0.001;

        // Repulsion from other nodes
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const distSq = dx * dx + dy * dy;
          const minDist = 1600;
          if (distSq < minDist * 4 && distSq > 0.1) {
            const force = 800 / distSq;
            nodes[i].vx += dx * force;
            nodes[i].vy += dy * force;
          }
        }
      }

      // Edge attraction
      for (const edge of edges) {
        const s = nodes.find((n) => n.id === edge.source);
        const t = nodes.find((n) => n.id === edge.target);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 80) {
          const force = (dist - 80) * 0.005;
          if (!s.pinned) { s.vx += dx / dist * force; s.vy += dy / dist * force; }
          if (!t.pinned) { t.vx -= dx / dist * force; t.vy -= dy / dist * force; }
        }
      }

      // Apply velocities + damping
      for (const node of nodes) {
        if (node.pinned) continue;
        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx;
        node.y += node.vy;
        node.x = Math.max(20, Math.min(W - 20, node.x));
        node.y = Math.max(20, Math.min(H - 20, node.y));
      }

      // Draw
      ctx.clearRect(0, 0, W, H);

      // Edges
      for (const edge of edges) {
        const s = nodes.find((n) => n.id === edge.source);
        const t = nodes.find((n) => n.id === edge.target);
        if (!s || !t) continue;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = "rgba(100,180,255,0.25)";
        ctx.lineWidth = Math.min(3, 0.5 + edge.weight * 0.3);
        ctx.stroke();

        // Relationship label at midpoint
        const mx = (s.x + t.x) / 2;
        const my = (s.y + t.y) / 2;
        ctx.font = "9px sans-serif";
        ctx.fillStyle = "rgba(150,170,190,0.6)";
        ctx.textAlign = "center";
        ctx.fillText(edge.relationship, mx, my - 4);
      }

      // Nodes
      for (const node of nodes) {
        const color = ENTITY_TYPE_COLORS[node.type] || "#64748b";
        const isSelected = node.id === selectedEntity;
        const isHovered = node.id === hoveredNode;
        const r = Math.max(5, Math.min(14, 4 + node.count * 0.5));

        // Glow for selected/hovered
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
          ctx.fillStyle = color + "44";
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? color : color + "cc";
        ctx.fill();
        ctx.strokeStyle = isSelected ? "#fff" : color;
        ctx.lineWidth = isSelected ? 2 : 0.5;
        ctx.stroke();

        // Label
        if (isSelected || isHovered || node.count > 3) {
          const label = node.id.length > 20 ? node.id.slice(0, 18) + ".." : node.id;
          ctx.font = `${isSelected || isHovered ? "bold " : ""}10px sans-serif`;
          ctx.fillStyle = isSelected || isHovered ? "#fff" : "rgba(200,210,220,0.7)";
          ctx.textAlign = "center";
          ctx.fillText(label, node.x, node.y + r + 12);
        }
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [selectedEntity, hoveredNode]);

  const getNodeAt = useCallback((x: number, y: number): GraphNode | null => {
    const nodes = nodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const r = Math.max(5, Math.min(14, 4 + n.count * 0.5));
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
      }
    } else {
      const node = getNodeAt(x, y);
      setHoveredNode(node?.id || null);
      if (canvasRef.current) {
        canvasRef.current.style.cursor = node ? "pointer" : "default";
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      const node = nodesRef.current.find((n) => n.id === dragRef.current!.nodeId);
      if (node) node.pinned = false;
      // If barely moved, treat as click
      const { x, y } = getCanvasPos(e);
      const clickNode = getNodeAt(x, y);
      if (clickNode && clickNode.id === dragRef.current.nodeId) {
        onSelectEntity(clickNode.id);
      }
      dragRef.current = null;
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={600}
      className="w-full rounded-lg border border-border-subtle bg-bg-base"
      style={{ height: 500 }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { dragRef.current = null; setHoveredNode(null); }}
    />
  );
}

export function EntityGraph({ sessionId }: Props) {
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [viewMode, setViewMode] = useState<"graph" | "list">("graph");

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

  const handleEntityClick = (entityValue: string) => {
    setSelectedEntity(entityValue);
    neighborsMutation.mutate(entityValue);
  };

  const neighbors: GraphNeighbor[] = neighborsMutation.data?.neighbors || [];

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-brand-primary">{entities.length}</p>
            <p className="text-xs text-text-muted">Total Entities</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">{entityTypes.length}</p>
            <p className="text-xs text-text-muted">Entity Types</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-purple-400">{graphStats?.total_edges ?? "—"}</p>
            <p className="text-xs text-text-muted">Relationships</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{killChainData?.stages?.length ?? "—"}</p>
            <p className="text-xs text-text-muted">Kill Chain Stages</p>
          </CardContent>
        </Card>
      </div>

      {/* View toggle + Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border-default overflow-hidden text-xs">
          <button
            onClick={() => setViewMode("graph")}
            className={`flex items-center gap-1 px-3 py-1.5 ${viewMode === "graph" ? "bg-brand-primary text-white" : "bg-bg-elevated text-text-muted"}`}
          >
            <GitBranch className="h-3 w-3" /> Graph
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`flex items-center gap-1 px-3 py-1.5 ${viewMode === "list" ? "bg-brand-primary text-white" : "bg-bg-elevated text-text-muted"}`}
          >
            <LayoutGrid className="h-3 w-3" /> List
          </button>
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

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-border-default bg-bg-elevated px-2 py-1.5 text-xs text-text-primary"
        >
          <option value="all">All types</option>
          {entityTypes.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
          ))}
        </select>

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

      {viewMode === "graph" ? (
        <div className="flex gap-4">
          {/* Graph canvas */}
          <div className="flex-1 min-w-0">
            <ForceGraph
              entities={filtered}
              neighbors={neighbors}
              selectedEntity={selectedEntity}
              onSelectEntity={handleEntityClick}
            />
          </div>

          {/* Sidebar: selected entity info */}
          <div className="w-72 flex-shrink-0">
            <Card className="sticky top-4">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-purple-400" />
                  {selectedEntity ? "Connections" : "Click a node"}
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-[400px] overflow-auto">
                {selectedEntity && (
                  <div className="mb-3 p-2 bg-bg-elevated rounded-lg">
                    <div className="font-mono text-xs text-text-primary break-all">{selectedEntity}</div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {entities.find((e) => e.value === selectedEntity)?.type.replace(/_/g, " ")}
                      {" · "}
                      {neighbors.length} connection{neighbors.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                )}
                {neighborsMutation.isPending && (
                  <p className="text-xs text-text-muted text-center py-4">Loading...</p>
                )}
                {selectedEntity && !neighborsMutation.isPending && neighbors.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-4">No relationships found</p>
                )}
                <div className="space-y-1">
                  {neighbors.map((n, i) => {
                    const Icon = ENTITY_TYPE_ICONS[n.type] || Network;
                    const color = ENTITY_TYPE_COLORS[n.type] || "#64748b";
                    return (
                      <button
                        key={i}
                        onClick={() => handleEntityClick(n.entity)}
                        className="w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 text-xs bg-bg-elevated/50 hover:bg-bg-hover transition-colors"
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
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Entity list */}
          <div className="flex-1">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Network className="h-4 w-4 text-brand-primary" />
                  Entities
                </CardTitle>
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
                        onClick={() => handleEntityClick(entity.value)}
                        className={`w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
                          isSelected
                            ? "bg-brand-primary/20 border border-brand-primary/50"
                            : "hover:bg-bg-hover border border-transparent"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />
                        <span className="font-mono truncate flex-1 text-text-primary">{entity.value}</span>
                        <span className="text-text-muted flex-shrink-0">{entity.type.replace(/_/g, " ")}</span>
                        <span className="text-text-muted flex-shrink-0">x{entity.count}</span>
                      </button>
                    );
                  })}
                  {filtered.length > 100 && (
                    <p className="text-xs text-text-muted text-center py-2">
                      Showing 100 of {filtered.length} entities
                    </p>
                  )}
                  {filtered.length === 0 && (
                    <p className="text-xs text-text-muted text-center py-6">No entities found</p>
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
                  <p className="text-xs text-text-muted text-center py-4">Loading neighbors...</p>
                )}
                {selectedEntity && !neighborsMutation.isPending && neighbors.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-4">No relationships found</p>
                )}
                <div className="space-y-1">
                  {neighbors.map((n, i) => {
                    const Icon = ENTITY_TYPE_ICONS[n.type] || Network;
                    const color = ENTITY_TYPE_COLORS[n.type] || "#64748b";
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs bg-bg-elevated/50"
                      >
                        <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono truncate text-text-primary">{n.entity}</div>
                          <div className="text-text-muted text-[10px]">{n.relationship}</div>
                        </div>
                        <span className="text-text-muted text-[10px]">w:{n.weight}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Kill chain summary */}
                {killChainData?.stages?.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border-subtle">
                    <h4 className="text-xs font-semibold text-text-secondary mb-2">Kill Chain Analysis</h4>
                    <div className="space-y-1">
                      {killChainData.stages.map((stage: { name: string; count: number }, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-text-muted">{stage.name}</span>
                          <span className="text-brand-primary">{stage.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Kill chain always visible at bottom */}
      {viewMode === "graph" && killChainData?.stages?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-400" />
              Kill Chain Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1">
              {killChainData.stages.map((stage: { name: string; count: number }, i: number) => (
                <div key={i} className="flex items-center">
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
