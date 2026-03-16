/**
 * InteractiveTimeline — Event density chart + event list with filtering.
 *
 * Uses a simple canvas-based density bar and event list.
 * No external charting lib required — uses raw SVG for the frequency histogram.
 */
import { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download, ChevronDown, ChevronRight, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { getTimelineStats, getTimelineEvents } from "@/services/api";

interface TimelineEvent {
  timestamp: string;
  source: string;
  event_type: string;
  description: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  login_success: "#22c55e",
  login_failure: "#ef4444",
  login_session: "#3b82f6",
  privilege_change: "#f59e0b",
  privilege_escalation: "#f59e0b",
  shell_command: "#8b5cf6",
  remote_access: "#06b6d4",
  file_deletion: "#ef4444",
  file_modified: "#f97316",
  file_accessed: "#64748b",
  file_changed: "#eab308",
  network_listen: "#3b82f6",
  network_established: "#10b981",
  network_download: "#06b6d4",
  process_snapshot: "#a855f7",
  scheduled_task: "#ec4899",
  cron_entry: "#ec4899",
  service_change: "#14b8a6",
  system: "#64748b",
  authentication: "#3b82f6",
};

function getEventColor(type: string): string {
  return EVENT_TYPE_COLORS[type] || "#64748b";
}

/** Responsive SVG bar chart for event frequency with hover tooltip and click-to-select. */
function FrequencyChart({ data, label, onBarClick, selectedKey }: { data: Record<string, number>; label?: string; onBarClick?: (key: string) => void; selectedKey?: string | null }) {
  const entries = Object.entries(data);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (entries.length === 0) return null;

  const max = Math.max(...entries.map(([, v]) => v));
  const barWidth = Math.max(4, Math.min(12, 600 / entries.length));
  const chartW = entries.length * (barWidth + 2);
  const chartH = 100;

  const getBarIndex = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return -1;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * chartW;
    return Math.floor(x / (barWidth + 2));
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const idx = getBarIndex(e);
    if (idx >= 0 && idx < entries.length) {
      const svg = svgRef.current!;
      const rect = svg.getBoundingClientRect();
      const [key, value] = entries[idx];
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top - 10, label: key, value });
    } else {
      setTooltip(null);
    }
  };

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onBarClick) return;
    const idx = getBarIndex(e);
    if (idx >= 0 && idx < entries.length) {
      onBarClick(entries[idx][0]);
    }
  };

  return (
    <div className="relative w-full overflow-hidden">
      {label && <p className="text-[10px] text-text-muted mb-1 font-medium uppercase tracking-wider">{label}</p>}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${chartW} ${chartH}`}
        preserveAspectRatio="none"
        className={`w-full h-24 block ${onBarClick ? "cursor-pointer" : ""}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        onClick={handleClick}
      >
        {entries.map(([key, value], i) => {
          const h = max > 0 ? (value / max) * 80 : 0;
          const isSelected = selectedKey === key;
          return (
            <rect
              key={key}
              x={i * (barWidth + 2)}
              y={90 - h}
              width={barWidth}
              height={h}
              rx={1}
              className={`transition-opacity ${isSelected ? "fill-brand-primary opacity-100" : "fill-brand-primary opacity-50 hover:opacity-80"}`}
            />
          );
        })}
      </svg>
      {tooltip && (
        <div
          className="absolute pointer-events-none z-10 bg-bg-elevated border border-border-default rounded-md px-2 py-1 text-[10px] text-text-primary shadow-lg whitespace-nowrap"
          style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-50%, -100%)" }}
        >
          <span className="font-medium">{tooltip.label}</span>: {tooltip.value} events
          {onBarClick && <span className="text-text-muted ml-1">· Click to filter</span>}
        </div>
      )}
    </div>
  );
}

interface Props {
  sessionId: string;
}

export function InteractiveTimeline({ sessionId }: Props) {
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [selectedHour, setSelectedHour] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { data: stats } = useQuery({
    queryKey: ["timeline-stats", sessionId],
    queryFn: () => getTimelineStats(sessionId),
  });

  const { data: timeline, isLoading } = useQuery({
    queryKey: ["timeline-events", sessionId],
    queryFn: () => getTimelineEvents(sessionId),
  });

  const events: TimelineEvent[] = timeline?.events || [];

  const eventTypes: string[] = useMemo(
    () => [...new Set(events.map((e: TimelineEvent) => e.event_type))].sort(),
    [events]
  );

  const filteredEvents = useMemo(() => {
    return events.filter((e: TimelineEvent) => {
      if (typeFilter.size > 0 && !typeFilter.has(e.event_type)) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        if (
          !e.description.toLowerCase().includes(q) &&
          !e.event_type.toLowerCase().includes(q) &&
          !(e.source || "").toLowerCase().includes(q)
        ) return false;
      }
      // Filter by selected hour from chart
      if (selectedHour && e.timestamp) {
        const eventHour = e.timestamp.slice(11, 13);
        if (eventHour !== selectedHour.padStart(2, "0")) return false;
      }
      // Filter by selected day from chart
      if (selectedDay && e.timestamp) {
        const eventDate = e.timestamp.slice(0, 10);
        if (eventDate !== selectedDay) return false;
      }
      return true;
    });
  }, [events, typeFilter, searchText, selectedHour, selectedDay]);

  const toggleType = (type: string) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleHourClick = (key: string) => {
    setSelectedDay(null);
    setSelectedHour(prev => prev === key ? null : key);
  };

  const handleDayClick = (key: string) => {
    setSelectedHour(null);
    setSelectedDay(prev => prev === key ? null : key);
  };

  const clearTimeFilter = () => {
    setSelectedHour(null);
    setSelectedDay(null);
  };

  const exportCsv = () => {
    const header = "timestamp,event_type,source,description\n";
    const rows = filteredEvents
      .map(
        (e) =>
          `"${e.timestamp}","${e.event_type}","${e.source}","${e.description.replace(/"/g, '""')}"`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timeline_${sessionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Controls — single filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <input
          type="text"
          placeholder="Search events..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="rounded-lg border border-border-default bg-bg-elevated px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted w-48"
        />

        {/* Active time filter chip */}
        {(selectedHour || selectedDay) && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-primary/10 text-brand-primary rounded-full text-[10px] font-medium">
            <Calendar className="h-3 w-3" />
            {selectedHour ? `Hour: ${selectedHour}` : `Day: ${selectedDay}`}
            <button onClick={clearTimeFilter} className="ml-0.5 hover:text-text-primary">×</button>
          </span>
        )}

        <button onClick={exportCsv} className="flex items-center gap-1 text-xs text-text-muted hover:text-brand-primary">
          <Download className="h-3 w-3" /> CSV
        </button>

        <span className="text-xs text-text-muted ml-auto">
          {filteredEvents.length} / {events.length} events
        </span>
      </div>

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {eventTypes.map((type) => (
          <button
            key={type}
            onClick={() => toggleType(type)}
            className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
              typeFilter.size === 0 || typeFilter.has(type)
                ? "border-brand-primary/40 bg-brand-primary/20 text-brand-primary"
                : "border-border-default bg-bg-elevated text-text-muted"
            }`}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full mr-1"
              style={{ backgroundColor: getEventColor(type) }}
            />
            {type.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {/* Chart — always visible on top */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4 text-brand-primary" />
              Event Activity
              <span className="font-normal text-text-muted">
                — {stats.total_events} total events
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats.by_hour && Object.keys(stats.by_hour).length > 0 && (
              <FrequencyChart data={stats.by_hour} label="Activity by Hour" onBarClick={handleHourClick} selectedKey={selectedHour} />
            )}
            {stats.by_day && Object.keys(stats.by_day).length > 0 && (
              <FrequencyChart data={stats.by_day} label="Activity by Day" onBarClick={handleDayClick} selectedKey={selectedDay} />
            )}
            <div className="flex flex-wrap gap-3 text-xs text-text-muted">
              {stats.busiest_hour && (
                <span>
                  Busiest hour: <span className="text-brand-primary">{stats.busiest_hour}</span>
                </span>
              )}
              {stats.busiest_day && (
                <span>
                  Busiest day: <span className="text-brand-primary">{stats.busiest_day}</span>
                </span>
              )}
              {stats.by_type && (
                <span>
                  Event types: <span className="text-brand-primary">{Object.keys(stats.by_type).length}</span>
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table — always visible below chart */}
      {isLoading ? (
        <p className="text-text-muted text-sm text-center py-8">Loading timeline...</p>
      ) : filteredEvents.length === 0 ? (
        <p className="text-text-muted text-sm text-center py-8">No events match filters.</p>
      ) : (
        <div className="max-h-[600px] overflow-auto rounded-lg border border-border-default">
          <table className="w-full text-xs text-left">
            <thead className="bg-bg-elevated sticky top-0">
              <tr>
                <th className="px-3 py-2 text-text-muted w-6"></th>
                <th className="px-3 py-2 text-text-muted">Time</th>
                <th className="px-3 py-2 text-text-muted">Type</th>
                <th className="px-3 py-2 text-text-muted">Source</th>
                <th className="px-3 py-2 text-text-muted">Description</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.slice(0, 1000).map((event, i) => {
                const isExpanded = expandedRow === i;
                return (
                  <>
                    <tr
                      key={i}
                      className="border-t border-border-subtle hover:bg-bg-hover cursor-pointer"
                      onClick={() => setExpandedRow(isExpanded ? null : i)}
                    >
                      <td className="px-3 py-1.5 text-text-muted">
                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-text-secondary whitespace-nowrap">
                        {event.timestamp?.slice(0, 19) || "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: getEventColor(event.event_type) + "22",
                            color: getEventColor(event.event_type),
                          }}
                        >
                          {event.event_type.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-text-muted truncate max-w-[120px]">{event.source}</td>
                      <td className="px-3 py-1.5 text-text-primary truncate max-w-[400px]">{event.description}</td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${i}-detail`} className="bg-bg-elevated">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="space-y-2 text-xs">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                              <div>
                                <span className="text-text-muted">Timestamp:</span>{" "}
                                <span className="font-mono text-text-primary">{event.timestamp}</span>
                              </div>
                              <div>
                                <span className="text-text-muted">Event Type:</span>{" "}
                                <span className="text-text-primary">{event.event_type}</span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-text-muted">Source:</span>{" "}
                                <span className="font-mono text-text-primary break-all">{event.source}</span>
                              </div>
                              {event.path && (
                                <div className="col-span-2">
                                  <span className="text-text-muted">Path:</span>{" "}
                                  <span className="font-mono text-text-primary break-all">{event.path}</span>
                                </div>
                              )}
                            </div>
                            <div>
                              <span className="text-text-muted">Description:</span>
                              <div className="mt-1 bg-bg-base rounded p-2 font-mono text-text-secondary whitespace-pre-wrap break-all border border-border-subtle">
                                {event.description}
                              </div>
                            </div>
                            {event.metadata && Object.keys(event.metadata).length > 0 && (
                              <div>
                                <span className="text-text-muted">Metadata:</span>
                                <div className="mt-1 bg-bg-base rounded p-2 font-mono text-[11px] text-text-secondary whitespace-pre-wrap break-all border border-border-subtle">
                                  {JSON.stringify(event.metadata, null, 2)}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
          {filteredEvents.length > 1000 && (
            <p className="text-center text-xs text-text-muted py-2">
              Showing first 1000 of {filteredEvents.length} events. Use filters to narrow down.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
