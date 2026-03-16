/**
 * QueryHistory - Shows recent queries and allows re-running them
 */
import { useState, useEffect } from "react";
import { History, ArrowRight, Trash2, Clock } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";

interface QueryHistoryItem {
  id: string;
  query: string;
  timestamp: Date;
  sessionId: string;
}

const STORAGE_KEY = "uac-query-history";
const MAX_HISTORY = 20;

// Helper to load history from localStorage
function loadHistory(): QueryHistoryItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const items = JSON.parse(stored);
      return items.map((item: QueryHistoryItem) => ({
        ...item,
        timestamp: new Date(item.timestamp),
      }));
    }
  } catch (e) {
    console.error("Failed to load query history:", e);
  }
  return [];
}

// Helper to save history to localStorage
function saveHistory(history: QueryHistoryItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch (e) {
    console.error("Failed to save query history:", e);
  }
}

// Export function to add queries from outside
export function addToQueryHistory(query: string, sessionId: string) {
  const history = loadHistory();
  const newItem: QueryHistoryItem = {
    id: Date.now().toString(),
    query,
    timestamp: new Date(),
    sessionId,
  };
  
  // Don't add duplicates of the same query in a row
  if (history.length > 0 && history[0].query === query) {
    return;
  }
  
  saveHistory([newItem, ...history]);
}

interface QueryHistoryProps {
  sessionId: string | null;
  onSelectQuery: (query: string) => void;
  compact?: boolean;
}

export function QueryHistory({ sessionId, onSelectQuery, compact = false }: QueryHistoryProps) {
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const filteredHistory = sessionId
    ? history.filter((item) => item.sessionId === sessionId)
    : history;

  const displayHistory = showAll ? filteredHistory : filteredHistory.slice(0, compact ? 3 : 5);

  const clearHistory = () => {
    if (sessionId) {
      const otherHistory = history.filter((item) => item.sessionId !== sessionId);
      saveHistory(otherHistory);
      setHistory(otherHistory);
    } else {
      saveHistory([]);
      setHistory([]);
    }
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (filteredHistory.length === 0) {
    return null;
  }

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-text-muted flex items-center gap-1">
            <History className="w-3 h-3" />
            Recent Queries
          </h4>
          {filteredHistory.length > 3 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="text-xs text-brand-primary hover:underline"
            >
              {showAll ? "Show less" : `+${filteredHistory.length - 3} more`}
            </button>
          )}
        </div>
        <div className="space-y-1">
          {displayHistory.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectQuery(item.query)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs rounded hover:bg-bg-hover transition-colors group"
            >
              <ArrowRight className="w-3 h-3 text-text-muted group-hover:text-brand-primary flex-shrink-0" />
              <span className="text-text-secondary group-hover:text-text-primary truncate flex-1">
                {item.query}
              </span>
              <span className="text-text-muted text-[10px] flex-shrink-0">
                {formatTime(item.timestamp)}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card className="p-0">
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="w-3.5 h-3.5" />
            Query History
          </CardTitle>
          <div className="flex items-center gap-1">
            {filteredHistory.length > 5 && (
              <button onClick={() => setShowAll(!showAll)} className="h-6 px-2 text-xs text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors">
                {showAll ? "Less" : "All"}
              </button>
            )}
            <button onClick={clearHistory} title="Clear history" className="h-6 w-6 p-0 flex items-center justify-center text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="py-2 px-3">
        <div className="space-y-1">
          {displayHistory.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectQuery(item.query)}
              className="w-full flex items-center gap-1.5 p-1.5 text-left rounded border border-border-subtle hover:border-brand-primary hover:bg-brand-primary/5 transition-colors group"
            >
              <ArrowRight className="w-3 h-3 text-text-muted group-hover:text-brand-primary flex-shrink-0" />
              <span className="text-xs text-text-secondary group-hover:text-text-primary flex-1 truncate">
                {item.query}
              </span>
              <span className="flex items-center gap-0.5 text-[10px] text-text-muted flex-shrink-0">
                <Clock className="w-2.5 h-2.5" />
                {formatTime(item.timestamp)}
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default QueryHistory;
