import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { 
  Clock, 
  Filter, 
  Download, 
  ChevronDown, 
  ChevronUp, 
  FolderOpen, 
  Search, 
  X, 
  Sparkles,
  FileText,
  Terminal,
  Network,
  UserCheck,
  Trash2,
  Shield,
  Eye
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ScrollToTop } from "@/components/ui/ScrollToTop";
import { InteractiveTimeline } from "@/components/features/InteractiveTimeline";
import { useInvestigationStore } from "@/stores/investigationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { getTimeline, getInvestigation } from "@/services/api";
import { useFocusShortcut } from "@/hooks/useKeyboardShortcuts";

interface TimelineEvent {
  timestamp: string;
  event_type: string;
  description: string;
  path: string;
}

// Event type styling configuration
const EVENT_TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  file_deletion: { icon: Trash2, color: "text-red-500", bg: "bg-red-500/10" },
  file_creation: { icon: FileText, color: "text-green-500", bg: "bg-green-500/10" },
  file_modification: { icon: FileText, color: "text-amber-500", bg: "bg-amber-500/10" },
  command_execution: { icon: Terminal, color: "text-blue-500", bg: "bg-blue-500/10" },
  network_connection: { icon: Network, color: "text-purple-500", bg: "bg-purple-500/10" },
  user_login: { icon: UserCheck, color: "text-cyan-500", bg: "bg-cyan-500/10" },
  user_logout: { icon: UserCheck, color: "text-slate-500", bg: "bg-slate-500/10" },
  permission_change: { icon: Shield, color: "text-orange-500", bg: "bg-orange-500/10" },
  process_start: { icon: Terminal, color: "text-indigo-500", bg: "bg-indigo-500/10" },
  process_end: { icon: Terminal, color: "text-slate-400", bg: "bg-slate-400/10" },
};

const DEFAULT_EVENT_CONFIG = { icon: Eye, color: "text-text-muted", bg: "bg-bg-elevated" };

function downloadTimelineCSV(events: TimelineEvent[], filename: string) {
  const header = "timestamp,event_type,description,path";
  const rows = events.map(e => 
    `"${e.timestamp}","${e.event_type}","${e.description.replace(/"/g, '""')}","${e.path.replace(/"/g, '""')}"`
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function highlightText(text: string, search: string): React.ReactNode {
  if (!search.trim()) return text;
  
  const regex = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  
  return parts.map((part, i) => 
    regex.test(part) ? (
      <mark key={i} className="bg-amber-500/30 text-text-primary rounded px-0.5">{part}</mark>
    ) : (
      part
    )
  );
}

// Table row component for individual events
function EventRow({ 
  event, 
  isExpanded, 
  onToggle, 
  onAskAI, 
  searchTerm 
}: { 
  event: TimelineEvent; 
  isExpanded: boolean; 
  onToggle: () => void;
  onAskAI: (event: TimelineEvent) => void;
  searchTerm: string;
}) {
  const config = EVENT_TYPE_CONFIG[event.event_type] || DEFAULT_EVENT_CONFIG;
  const Icon = config.icon;

  return (
    <>
      <tr 
        className={`group hover:bg-bg-hover transition-colors cursor-pointer ${isExpanded ? 'bg-bg-elevated' : ''}`}
        onClick={onToggle}
      >
        {/* Timestamp */}
        <td className="px-4 py-3 text-xs font-mono text-text-muted whitespace-nowrap">
          {highlightText(event.timestamp, searchTerm)}
        </td>
        
        {/* Event Type Badge */}
        <td className="px-4 py-3">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.color}`}>
            <Icon className="w-3 h-3" />
            {highlightText(event.event_type.replace(/_/g, ' '), searchTerm)}
          </span>
        </td>
        
        {/* Description */}
        <td className="px-4 py-3 max-w-md">
          <p className={`text-sm text-text-primary ${isExpanded ? '' : 'truncate'}`}>
            {highlightText(event.description, searchTerm)}
          </p>
        </td>
        
        {/* Source Path */}
        <td className="px-4 py-3 max-w-xs">
          <p className="text-xs text-text-muted font-mono truncate">
            {highlightText(event.path, searchTerm)}
          </p>
        </td>
        
        {/* Actions */}
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onAskAI(event); }}
              className="p-1.5 rounded-lg hover:bg-brand-primary/10 text-text-muted hover:text-brand-primary transition-colors"
              title="Ask AI about this event"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              className="p-1.5 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </td>
      </tr>
      
      {/* Expanded Details Row */}
      {isExpanded && (
        <tr className="bg-bg-elevated border-b border-border-subtle">
          <td colSpan={5} className="px-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Full Description</h4>
                <p className="text-text-primary bg-bg-base rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">
                  {event.description}
                </p>
              </div>
              <div>
                <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Source File</h4>
                <p className="text-text-primary bg-bg-base rounded-lg p-3 font-mono text-xs break-all">
                  {event.path}
                </p>
                <div className="mt-4">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => { e.stopPropagation(); onAskAI(event); }}
                    className="w-full"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Ask AI About This Event
                  </Button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function Timeline() {
  const navigate = useNavigate();
  const { currentInvestigation } = useInvestigationStore();
  const { sessionId, setSession } = useSessionStore();
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  useFocusShortcut(searchInputRef);
  
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(sessionId);
  const [viewMode, setViewMode] = useState<"table" | "interactive">("table");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [textSearch, setTextSearch] = useState("");
  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([]);
  const [showEventTypeFilter, setShowEventTypeFilter] = useState(false);
  const [visibleCount, setVisibleCount] = useState(100);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const { data: investigationDetail } = useQuery({
    queryKey: ["investigation", currentInvestigation?.id],
    queryFn: () => currentInvestigation ? getInvestigation(currentInvestigation.id) : null,
    enabled: !!currentInvestigation,
    refetchOnMount: "always",
  });

  const sessions = investigationDetail?.sessions || [];
  const readySessions = sessions.filter(s => s.status === "ready" || s.status === "searchable");
  
  // Reset selectedSessionId when investigation changes or if current selection is not valid
  useEffect(() => {
    if (readySessions.length > 0) {
      const validSessionIds = readySessions.map(s => s.session_id);
      if (!selectedSessionId || !validSessionIds.includes(selectedSessionId)) {
        setSelectedSessionId(readySessions[0].session_id);
      }
    } else {
      setSelectedSessionId(null);
    }
  }, [currentInvestigation?.id, readySessions.length]);
  
  const effectiveSessionId = selectedSessionId || readySessions[0]?.session_id || null;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["timeline", effectiveSessionId, startDate, endDate],
    queryFn: () => getTimeline(effectiveSessionId!, startDate || undefined, endDate || undefined),
    enabled: !!effectiveSessionId,
  });

  const eventTypes = useMemo((): string[] => {
    if (!data?.events) return [];
    return [...new Set(data.events.map((e: TimelineEvent) => e.event_type))].sort() as string[];
  }, [data]);

  const filteredEvents = useMemo(() => {
    if (!data?.events) return [];
    let filtered = data.events;
    
    if (selectedEventTypes.length > 0) {
      filtered = filtered.filter((e: TimelineEvent) => selectedEventTypes.includes(e.event_type));
    }
    
    if (textSearch.trim()) {
      const searchLower = textSearch.toLowerCase();
      filtered = filtered.filter((e: TimelineEvent) => 
        e.description.toLowerCase().includes(searchLower) ||
        e.path.toLowerCase().includes(searchLower) ||
        e.event_type.toLowerCase().includes(searchLower) ||
        e.timestamp.toLowerCase().includes(searchLower)
      );
    }
    
    return filtered;
  }, [data, selectedEventTypes, textSearch]);

  const handleEventTypeToggle = (type: string) => {
    setSelectedEventTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const handleExport = () => {
    if (filteredEvents.length > 0) {
      downloadTimelineCSV(filteredEvents, `timeline-${Date.now()}.csv`);
    }
  };

  const handleSessionSelect = (sid: string) => {
    setSelectedSessionId(sid);
    setSession(sid);
  };

  const handleAskAI = (event: TimelineEvent) => {
    const question = `Tell me more about this event: "${event.description}" (${event.event_type}) from ${event.path}`;
    navigate(`/query?q=${encodeURIComponent(question)}`);
  };

  const toggleRowExpansion = (index: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // No investigation selected
  if (!currentInvestigation) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 mx-auto bg-purple-500/10 rounded-2xl flex items-center justify-center">
            <Clock className="w-8 h-8 text-purple-500" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-semibold mb-2">
              Timeline View
            </h1>
            <p className="text-text-secondary">
              Select an investigation to view the timeline of events.
            </p>
          </div>
          <Button size="lg" onClick={() => navigate("/investigations")}>
            <FolderOpen className="w-5 h-5 mr-2" />
            Select Investigation
          </Button>
        </div>
      </div>
    );
  }

  // No sessions available
  if (readySessions.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 mx-auto bg-purple-500/10 rounded-2xl flex items-center justify-center">
            <Clock className="w-8 h-8 text-purple-500" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-semibold mb-2">
              No Data Available
            </h1>
            <p className="text-text-secondary">
              Upload a UAC output file to view the timeline.
            </p>
          </div>
          <Button size="lg" onClick={() => navigate("/")}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      {/* Compact Header with Filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-purple-500/10 rounded-lg flex items-center justify-center">
            <Clock className="w-4 h-4 text-purple-500" />
          </div>
          <h1 className="text-lg font-heading font-semibold">Timeline</h1>
          {/* View mode toggle */}
          <div className="flex rounded-lg border border-border-default overflow-hidden text-xs ml-2">
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-1.5 transition-colors ${viewMode === "table" ? "bg-brand-primary text-white" : "bg-bg-base text-text-muted hover:text-text-primary"}`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode("interactive")}
              className={`px-3 py-1.5 transition-colors ${viewMode === "interactive" ? "bg-brand-primary text-white" : "bg-bg-base text-text-muted hover:text-text-primary"}`}
            >
              Interactive
            </button>
          </div>
        </div>
        
        {/* Inline Filters */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          {/* Session Selector */}
          <select
            value={effectiveSessionId || ""}
            onChange={(e) => handleSessionSelect(e.target.value)}
            className="px-2 py-1.5 bg-bg-base border border-border-default rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary/50 max-w-[180px]"
          >
            {readySessions.map((session) => (
              <option key={session.session_id} value={session.session_id}>
                {session.original_filename}
              </option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-[280px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search events... (Ctrl+K)"
              value={textSearch}
              onChange={(e) => setTextSearch(e.target.value)}
              className="pl-8 pr-7 text-sm h-8"
            />
            {textSearch && (
              <button
                onClick={() => setTextSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Date Range - Compact */}
          <div className="flex items-center gap-1">
            <Input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-xs h-8 w-[155px] px-2"
            />
            <span className="text-text-muted text-xs">→</span>
            <Input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-xs h-8 w-[155px] px-2"
            />
          </div>

          {/* Event Type Filter */}
          <div className="relative">
            <Button
              variant={selectedEventTypes.length > 0 ? "primary" : "secondary"}
              size="sm"
              onClick={() => setShowEventTypeFilter(!showEventTypeFilter)}
              className="h-8 text-xs px-2"
            >
              <Filter className="w-3.5 h-3.5 mr-1" />
              {selectedEventTypes.length > 0 ? `${selectedEventTypes.length}` : "Types"}
              <ChevronDown className="w-3.5 h-3.5 ml-1" />
            </Button>
            {showEventTypeFilter && eventTypes.length > 0 && (
              <div className="absolute top-full mt-1 right-0 z-20 bg-bg-surface border border-border-default rounded-lg shadow-xl p-2 min-w-[220px] max-h-[300px] overflow-y-auto">
                <button
                  onClick={() => setSelectedEventTypes([])}
                  className="w-full text-left px-2 py-1 text-xs text-text-muted hover:text-text-primary mb-1"
                >
                  Clear all
                </button>
                {eventTypes.map((type) => {
                  const config = EVENT_TYPE_CONFIG[type] || DEFAULT_EVENT_CONFIG;
                  const Icon = config.icon;
                  return (
                    <label
                      key={type}
                      className="flex items-center gap-2 px-2 py-1.5 hover:bg-bg-hover rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEventTypes.includes(type)}
                        onChange={() => handleEventTypeToggle(type)}
                        className="accent-brand-primary"
                      />
                      <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                      <span className="text-sm text-text-primary">{type.replace(/_/g, ' ')}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {(startDate || endDate || textSearch || selectedEventTypes.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs px-2"
              onClick={() => {
                setStartDate("");
                setEndDate("");
                setTextSearch("");
                setSelectedEventTypes([]);
              }}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}

          <Button variant="secondary" size="sm" className="h-8 text-xs px-2" onClick={handleExport} disabled={filteredEvents.length === 0}>
            <Download className="w-3.5 h-3.5 mr-1" />
            CSV
          </Button>
        </div>
      </div>

      {/* Stats Bar - More compact */}
      {data && (
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span>
            Showing <span className="font-semibold text-brand-primary">{Math.min(visibleCount, filteredEvents.length)}</span> of{" "}
            <span className="font-medium text-text-primary">{filteredEvents.length}</span> events
          </span>
          {data.time_range?.start && (
            <span>
              From <span className="font-mono">{data.time_range.start}</span>
            </span>
          )}
          {data.time_range?.end && (
            <span>
              to <span className="font-mono">{data.time_range.end}</span>
            </span>
          )}
        </div>
      )}

      {/* Interactive View */}
      {viewMode === "interactive" && effectiveSessionId && (
        <div className="flex-1 min-h-0 overflow-auto">
          <InteractiveTimeline sessionId={effectiveSessionId} />
        </div>
      )}

      {/* Timeline Table */}
      {viewMode === "table" && (
      <div className="flex-1 bg-bg-surface border border-border-subtle rounded-xl overflow-hidden flex flex-col min-h-0">
        {isLoading && (
          <div className="flex-1 flex items-center justify-center text-text-muted">
            <div className="animate-spin w-6 h-6 border-2 border-brand-primary border-t-transparent rounded-full mr-3" />
            Loading timeline...
          </div>
        )}

        {isError && (
          <div className="flex-1 flex items-center justify-center text-error">
            Error: {(error as Error).message}
          </div>
        )}

        {!isLoading && !isError && filteredEvents.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-text-muted">
            No events found matching your filters
          </div>
        )}

        {filteredEvents.length > 0 && (
          <div className="flex-1 overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-bg-elevated border-b border-border-subtle z-10">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide w-48">
                    Timestamp
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide w-48">
                    Event Type
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">
                    Description
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide w-64">
                    Source
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide w-24">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredEvents.slice(0, visibleCount).map((event: TimelineEvent, index: number) => (
                  <EventRow
                    key={index}
                    event={event}
                    isExpanded={expandedRows.has(index)}
                    onToggle={() => toggleRowExpansion(index)}
                    onAskAI={handleAskAI}
                    searchTerm={textSearch}
                  />
                ))}
              </tbody>
            </table>
            
            {filteredEvents.length > visibleCount && (
              <div className="p-4 text-center border-t border-border-subtle bg-bg-surface">
                <Button
                  variant="secondary"
                  onClick={() => setVisibleCount(prev => prev + 100)}
                >
                  Load more ({filteredEvents.length - visibleCount} remaining)
                  <ChevronDown className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      <ScrollToTop />
    </div>
  );
}
