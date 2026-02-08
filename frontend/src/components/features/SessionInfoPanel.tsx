/**
 * SessionInfoPanel - Shows what the AI knows about the current session
 * 
 * Helps users understand what data has been indexed and what the AI can query.
 */
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Database,
  Folder,
  Hash,
  Clock,
  Server,
  RefreshCw,
  Eye,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { getSessionStats } from "@/services/api";

interface SessionInfoPanelProps {
  sessionId: string | null;
  compact?: boolean;
}

function formatCategory(category: string): string {
  return category
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function CategoryPill({ name, count }: { name: string; count: number }) {
  const colors: Record<string, string> = {
    users: "bg-blue-500/10 text-blue-500",
    authentication: "bg-red-500/10 text-red-500",
    network: "bg-green-500/10 text-green-500",
    persistence: "bg-purple-500/10 text-purple-500",
    logs: "bg-yellow-500/10 text-yellow-500",
    configuration: "bg-orange-500/10 text-orange-500",
    processes: "bg-pink-500/10 text-pink-500",
    filesystem: "bg-cyan-500/10 text-cyan-500",
    other: "bg-gray-500/10 text-gray-500",
    unknown: "bg-gray-500/10 text-gray-500",
  };
  
  const colorClass = colors[name.toLowerCase()] || colors.other;
  
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colorClass}`}>
      {formatCategory(name)} ({count})
    </span>
  );
}

export function SessionInfoPanel({ sessionId, compact = false }: SessionInfoPanelProps) {
  const [expanded, setExpanded] = useState(!compact);

  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: ["session-stats", sessionId],
    queryFn: () => getSessionStats(sessionId!),
    enabled: !!sessionId,
    staleTime: 30000, // Cache for 30 seconds
  });

  if (!sessionId) {
    return null;
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center gap-2 text-text-muted py-4">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Loading session info...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !stats) {
    return (
      <Card className="border-error/30">
        <CardContent>
          <p className="text-sm text-error py-4">
            Failed to load session information
          </p>
        </CardContent>
      </Card>
    );
  }

  if (compact && !expanded) {
    return (
      <div 
        className="cursor-pointer hover:bg-bg-hover transition-colors rounded-lg"
        onClick={() => setExpanded(true)}
      >
        <Card>
          <CardContent>
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-brand-primary" />
                  <span className="text-sm font-medium">AI Context</span>
                </div>
                <span className="text-xs text-text-muted">
                  {stats.total_files} files • {stats.total_chunks} chunks • {Object.keys(stats.categories || {}).length} categories
                </span>
              </div>
              <ChevronDown className="w-4 h-4 text-text-muted" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="w-4 h-4" />
            What the AI Can See
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => refetch()}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            {compact && (
              <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>
                <ChevronUp className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* System Info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.hostname && (
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-text-muted" />
              <div>
                <p className="text-xs text-text-muted">Host</p>
                <p className="text-sm font-mono">{stats.hostname}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-text-muted" />
            <div>
              <p className="text-xs text-text-muted">Files</p>
              <p className="text-sm font-semibold">{stats.total_files.toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-text-muted" />
            <div>
              <p className="text-xs text-text-muted">Chunks</p>
              <p className="text-sm font-semibold">{stats.total_chunks.toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4 text-text-muted" />
            <div>
              <p className="text-xs text-text-muted">Tokens</p>
              <p className="text-sm font-semibold">{stats.total_tokens.toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* Categories */}
        <div>
          <p className="text-xs text-text-muted mb-2 flex items-center gap-1">
            <Folder className="w-3 h-3" />
            Indexed Categories
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.categories || {})
              .sort(([, a], [, b]) => b - a)
              .map(([category, count]) => (
                <CategoryPill key={category} name={category} count={count} />
              ))}
          </div>
        </div>

        {/* Top Accessed */}
        {stats.top_accessed_sources.length > 0 && stats.top_accessed_sources[0].access_count > 0 && (
          <div>
            <p className="text-xs text-text-muted mb-2 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Most Queried Sources
            </p>
            <div className="space-y-1">
              {stats.top_accessed_sources
                .filter(s => s.access_count > 0)
                .slice(0, 3)
                .map((source, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-text-secondary font-mono truncate max-w-[200px]">
                      {source.source_file.split('/').pop()}
                    </span>
                    <span className="text-text-muted">{source.access_count}×</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Performance */}
        {stats.cache_stats.hits > 0 && (
          <div className="pt-2 border-t border-border-subtle">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Cache Performance</span>
              <span className="text-text-secondary">
                {Math.round(stats.cache_stats.hit_rate * 100)}% hit rate
                ({stats.cache_stats.hits} hits / {stats.cache_stats.misses} misses)
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SessionInfoPanel;
