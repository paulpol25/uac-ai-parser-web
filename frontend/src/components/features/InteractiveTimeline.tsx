/**
 * InteractiveTimeline — Event density chart + event list with filtering.
 *
 * Uses a simple canvas-based density bar and event list.
 * No external charting lib required — uses raw SVG for the frequency histogram.
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download } from "lucide-react";
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

/** Simple SVG bar chart for event frequency. */
function FrequencyChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  const max = Math.max(...entries.map(([, v]) => v));
  const barWidth = Math.max(2, Math.floor(600 / entries.length));

  return (
    <div className="overflow-x-auto">
      <svg width={entries.length * barWidth + 20} height={80} className="block">
        {entries.map(([key, value], i) => {
          const h = max > 0 ? (value / max) * 60 : 0;
          return (
            <g key={key}>
              <rect
                x={i * barWidth + 10}
                y={70 - h}
                width={Math.max(1, barWidth - 1)}
                height={h}
                fill="#00d9ff"
                opacity={0.7}
              >
                <title>{`${key}: ${value} events`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface Props {
  sessionId: string;
}

export function InteractiveTimeline({ sessionId }: Props) {
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const [view, setView] = useState<"chart" | "table">("chart");

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
        return (
          e.description.toLowerCase().includes(q) ||
          e.event_type.toLowerCase().includes(q) ||
          (e.source || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [events, typeFilter, searchText]);

  const toggleType = (type: string) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
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
      {/* Stats summary */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4 text-cyan-400" />
              Event Activity
              <span className="font-normal text-zinc-400">
                — {stats.total_events} total events
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FrequencyChart data={stats.by_hour} />
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-400">
              {stats.busiest_hour && (
                <span>
                  Busiest hour: <span className="text-cyan-400">{stats.busiest_hour}</span>
                </span>
              )}
              {stats.busiest_day && (
                <span>
                  Busiest day: <span className="text-cyan-400">{stats.busiest_day}</span>
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* View toggle */}
        <div className="flex rounded-lg border border-zinc-700 overflow-hidden text-xs">
          <button
            onClick={() => setView("chart")}
            className={`px-3 py-1.5 ${view === "chart" ? "bg-cyan-600 text-white" : "bg-zinc-800 text-zinc-400"}`}
          >
            Chart
          </button>
          <button
            onClick={() => setView("table")}
            className={`px-3 py-1.5 ${view === "table" ? "bg-cyan-600 text-white" : "bg-zinc-800 text-zinc-400"}`}
          >
            Table
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search events..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 w-48"
        />

        <button onClick={exportCsv} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-cyan-400">
          <Download className="h-3 w-3" /> CSV
        </button>

        <span className="text-xs text-zinc-500 ml-auto">
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
                ? "border-cyan-600/40 bg-cyan-600/20 text-cyan-300"
                : "border-zinc-700 bg-zinc-800 text-zinc-500"
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

      {/* Event list */}
      {isLoading ? (
        <p className="text-zinc-400 text-sm text-center py-8">Loading timeline...</p>
      ) : filteredEvents.length === 0 ? (
        <p className="text-zinc-500 text-sm text-center py-8">No events match filters.</p>
      ) : (
        <div className="max-h-[600px] overflow-auto rounded-lg border border-zinc-700">
          <table className="w-full text-xs text-left">
            <thead className="bg-zinc-800 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-zinc-400">Time</th>
                <th className="px-3 py-2 text-zinc-400">Type</th>
                <th className="px-3 py-2 text-zinc-400">Source</th>
                <th className="px-3 py-2 text-zinc-400">Description</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.slice(0, 1000).map((event, i) => (
                <tr key={i} className="border-t border-zinc-800 hover:bg-zinc-800/50">
                  <td className="px-3 py-1.5 font-mono text-zinc-400 whitespace-nowrap">
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
                  <td className="px-3 py-1.5 text-zinc-500 truncate max-w-[120px]">{event.source}</td>
                  <td className="px-3 py-1.5 text-zinc-300 truncate max-w-[400px]">{event.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredEvents.length > 1000 && (
            <p className="text-center text-xs text-zinc-500 py-2">
              Showing first 1000 of {filteredEvents.length} events. Use filters to narrow down.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
