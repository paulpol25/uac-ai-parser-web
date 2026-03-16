/**
 * ContextPreview - Shows what chunks/context the AI will use to answer a query
 * 
 * Helps users understand how the AI finds relevant information.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  FileText,
  ChevronDown,
  ChevronUp,
  Layers,
  Clock,
  Tag,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Loader";
import { Input } from "@/components/ui/Input";
import { previewContext, type ChunkPreview } from "@/services/api";

interface ContextPreviewProps {
  sessionId: string | null;
  currentQuery?: string;
  onQueryChange?: (query: string) => void;
}

function ChunkCard({ chunk, index }: { chunk: ChunkPreview; index: number }) {
  const [expanded, setExpanded] = useState(false);
  
  const categoryColors: Record<string, string> = {
    users: "bg-blue-500",
    authentication: "bg-red-500",
    network: "bg-green-500",
    persistence: "bg-purple-500",
    logs: "bg-yellow-500",
    configuration: "bg-orange-500",
    other: "bg-gray-500",
  };
  
  const colorClass = categoryColors[chunk.category?.toLowerCase()] || categoryColors.other;
  
  return (
    <div className="border border-border-subtle rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-bg-hover transition-colors"
      >
        <div className={`w-1 h-10 rounded-full ${colorClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-text-muted">#{index + 1}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary">
              {chunk.category || "unknown"}
            </span>
            <span className="text-xs text-text-muted">
              {Math.round(chunk.score * 100)}% match
            </span>
          </div>
          <p className="text-sm text-text-secondary mt-1 truncate font-mono">
            {chunk.source}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
        )}
      </button>
      
      {expanded && (
        <div className="px-3 pb-3 border-t border-border-subtle bg-bg-elevated">
          <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono mt-2 max-h-48 overflow-auto">
            {chunk.text}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ContextPreview({ sessionId, currentQuery, onQueryChange }: ContextPreviewProps) {
  const [previewQuery, setPreviewQuery] = useState(currentQuery || "");
  const [shouldFetch, setShouldFetch] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["context-preview", sessionId, previewQuery],
    queryFn: () => previewContext(sessionId!, previewQuery),
    enabled: !!sessionId && !!previewQuery && shouldFetch,
    staleTime: 60000, // Cache for 1 minute
  });

  const handlePreview = () => {
    if (previewQuery.trim()) {
      setShouldFetch(true);
      if (shouldFetch) {
        refetch();
      }
    }
  };

  if (!sessionId) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="w-4 h-4" />
          Context Preview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-text-muted">
          See what information the AI will use to answer your question.
        </p>

        {/* Query Input */}
        <div className="flex gap-2">
          <Input
            placeholder="Enter a test query..."
            value={previewQuery}
            onChange={(e) => {
              setPreviewQuery(e.target.value);
              onQueryChange?.(e.target.value);
            }}
            onKeyDown={(e) => e.key === "Enter" && handlePreview()}
            className="text-sm"
          />
          <button
            onClick={handlePreview}
            disabled={!previewQuery.trim() || isLoading}
            className="p-2 text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            {isLoading ? (
              <Spinner className="w-4 h-4" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Results */}
        {data && (
          <div className="space-y-3">
            {/* Stats */}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1 text-text-muted">
                <FileText className="w-3 h-3" />
                {data.chunks_retrieved} chunks retrieved
              </div>
              <div className="flex items-center gap-1 text-text-muted">
                <Clock className="w-3 h-3" />
                {data.retrieval_time_ms}ms
              </div>
              <div className="flex items-center gap-1">
                <Tag className="w-3 h-3 text-text-muted" />
                <span className="text-text-muted">Categories:</span>
                {data.inferred_categories.map((cat) => (
                  <span key={cat} className="px-1.5 py-0.5 bg-bg-elevated rounded text-text-secondary">
                    {cat}
                  </span>
                ))}
              </div>
            </div>

            {/* Chunks */}
            {data.chunks.length > 0 ? (
              <div className="space-y-2">
                {data.chunks.map((chunk, i) => (
                  <ChunkCard key={i} chunk={chunk} index={i} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted text-center py-4">
                No relevant chunks found for this query.
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-error">
            Error: {(error as Error).message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default ContextPreview;
