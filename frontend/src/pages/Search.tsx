import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { 
  Search as SearchIcon, 
  ChevronDown, 
  ChevronUp, 
  FileText, 
  Database, 
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Copy,
  Check,
  Sparkles,
  X
} from "lucide-react";
import { Spinner } from "@/components/ui/Loader";
import { Input } from "@/components/ui/Input";
import { ScrollToTop } from "@/components/ui/ScrollToTop";
import { useInvestigationStore } from "@/stores/investigationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { getInvestigation } from "@/services/api";
import { useFocusShortcut } from "@/hooks/useKeyboardShortcuts";

const API_BASE = "/api/v1";

interface SearchResult {
  chunk_id: string;
  content: string;
  source_file: string;
  source_type: string;
  artifact_category: string;
  section: string | null;
  importance_score: number;
  file_modified: string | null;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
  has_next: boolean;
  has_prev: boolean;
}

interface FilterOptions {
  source_types: string[];
  artifact_categories: string[];
}

async function searchLogs(
  sessionId: string,
  query: string,
  sourceType?: string,
  artifactCategory?: string,
  page: number = 1,
  perPage: number = 50
): Promise<SearchResponse> {
  const params = new URLSearchParams();
  params.set("session_id", sessionId);
  if (query) params.set("q", query);
  if (sourceType) params.set("source_type", sourceType);
  if (artifactCategory) params.set("artifact_category", artifactCategory);
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  
  const response = await fetch(`${API_BASE}/search?${params.toString()}`, {
    credentials: "include",
  });
  
  if (!response.ok) {
    throw new Error("Failed to search logs");
  }
  
  return response.json();
}

async function getSearchFilters(sessionId: string): Promise<FilterOptions> {
  const response = await fetch(`${API_BASE}/search/filters?session_id=${sessionId}`, {
    credentials: "include",
  });
  
  if (!response.ok) {
    throw new Error("Failed to get filter options");
  }
  
  return response.json();
}

function highlightMatches(text: string, query: string): JSX.Element {
  if (!query.trim()) {
    return <span>{text}</span>;
  }
  
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  
  return (
    <>
      {parts.map((part, i) => 
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function ResultCard({ 
  result, 
  query, 
  isExpanded, 
  onToggle,
  onAskAI 
}: { 
  result: SearchResult; 
  query: string;
  isExpanded: boolean;
  onToggle: () => void;
  onAskAI: (result: SearchResult) => void;
}) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(result.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const preview = result.content.slice(0, 200) + (result.content.length > 200 ? "..." : "");
  
  return (
    <div className={`bg-bg-surface border border-border-subtle rounded-xl overflow-hidden transition-all ${isExpanded ? 'ring-1 ring-brand-primary/30' : 'hover:border-border-default'}`}>
      {/* Header - clickable to expand */}
      <div 
        className="p-4 cursor-pointer hover:bg-bg-hover/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-brand-primary flex-shrink-0" />
              <span className="font-mono text-sm text-text-primary truncate font-medium">
                {result.source_file}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-full font-medium">
                {result.source_type}
              </span>
              {result.artifact_category && (
                <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full font-medium">
                  {result.artifact_category}
                </span>
              )}
              {result.section && (
                <span className="px-2 py-0.5 bg-text-muted/10 text-text-muted rounded-full">
                  {result.section}
                </span>
              )}
              {result.importance_score > 0.5 && (
                <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-full">
                  Relevance: {(result.importance_score * 100).toFixed(0)}%
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onAskAI(result)}
              className="p-1.5 rounded-lg hover:bg-brand-primary/10 text-text-muted hover:text-brand-primary transition-colors"
              title="Ask AI about this"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
              title="Copy content"
            >
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              onClick={onToggle}
              className="p-1.5 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
      
      {/* Content Preview / Full */}
      <div className={`px-4 pb-4 ${isExpanded ? 'pt-0' : ''}`}>
        <div className={`bg-bg-base rounded-lg p-3 ${isExpanded ? 'max-h-96 overflow-auto' : ''}`}>
          <pre className="font-mono text-xs text-text-secondary whitespace-pre-wrap break-words">
            {isExpanded ? highlightMatches(result.content, query) : highlightMatches(preview, query)}
          </pre>
        </div>
        {!isExpanded && result.content.length > 200 && (
          <button
            className="mt-2 text-xs text-brand-primary hover:text-brand-primary-hover font-medium"
            onClick={onToggle}
          >
            Show full content...
          </button>
        )}
        {isExpanded && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onAskAI(result)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-elevated text-text-secondary border border-border-default rounded-lg hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Ask AI About This
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Search() {
  const navigate = useNavigate();
  const { currentInvestigation } = useInvestigationStore();
  const { sessionId, setSession } = useSessionStore();
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // Keyboard shortcut: Ctrl+K to focus search input
  useFocusShortcut(searchInputRef);
  
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(sessionId);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set());
  const perPage = 25;

  // Fetch investigation details with sessions
  const { data: investigationDetail } = useQuery({
    queryKey: ["investigation", currentInvestigation?.id],
    queryFn: () => currentInvestigation ? getInvestigation(currentInvestigation.id) : null,
    enabled: !!currentInvestigation,
    refetchOnMount: "always",  // Ensure fresh session data when navigating here
  });

  const sessions = investigationDetail?.sessions || [];
  // Include "searchable" sessions - they have search data even if AI embeddings aren't done
  const readySessions = sessions.filter((s: { status: string }) => s.status === "ready" || s.status === "searchable");
  
  // Reset selectedSessionId when investigation changes or if current selection is not valid
  useEffect(() => {
    if (readySessions.length > 0) {
      const validSessionIds = readySessions.map((s: { session_id: string }) => s.session_id);
      if (!selectedSessionId || !validSessionIds.includes(selectedSessionId)) {
        setSelectedSessionId(readySessions[0].session_id);
      }
    } else {
      setSelectedSessionId(null);
    }
  }, [currentInvestigation?.id, readySessions.length]);
  
  // Auto-select first session if none selected
  const effectiveSessionId = selectedSessionId || readySessions[0]?.session_id || null;

  // Fetch filter options
  const { data: filterOptions } = useQuery({
    queryKey: ["searchFilters", effectiveSessionId],
    queryFn: () => getSearchFilters(effectiveSessionId!),
    enabled: !!effectiveSessionId,
  });

  // Search query
  const { data, isLoading, isError } = useQuery({
    queryKey: ["search", effectiveSessionId, activeQuery, sourceTypeFilter, categoryFilter, page],
    queryFn: () => searchLogs(
      effectiveSessionId!,
      activeQuery,
      sourceTypeFilter || undefined,
      categoryFilter || undefined,
      page,
      perPage
    ),
    enabled: !!effectiveSessionId,
  });

  const handleSearch = useCallback(() => {
    setActiveQuery(searchQuery);
    setPage(1);
  }, [searchQuery]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handleSessionSelect = (sid: string) => {
    setSelectedSessionId(sid);
    setSession(sid);
    setPage(1);
  };

  const toggleExpanded = (chunkId: string) => {
    setExpandedChunks(prev => {
      const next = new Set(prev);
      if (next.has(chunkId)) {
        next.delete(chunkId);
      } else {
        next.add(chunkId);
      }
      return next;
    });
  };

  const handleAskAI = (result: SearchResult) => {
    const question = `Analyze this log entry from ${result.source_file}:\n\n${result.content}`;
    navigate(`/query?q=${encodeURIComponent(question)}`);
  };

  // No investigation selected
  if (!currentInvestigation) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 mx-auto bg-bg-surface rounded-2xl flex items-center justify-center">
            <FolderOpen className="w-8 h-8 text-text-muted" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-heading font-semibold">No Investigation Selected</h2>
            <p className="text-text-secondary">
              Select an investigation to search through its parsed logs and artifacts.
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors" onClick={() => navigate("/investigations")}>
            <FolderOpen className="w-4 h-4" />
            Go to Investigations
          </button>
        </div>
      </div>
    );
  }

  // No sessions available
  if (readySessions.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 mx-auto bg-bg-surface rounded-2xl flex items-center justify-center">
            <Database className="w-8 h-8 text-text-muted" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-heading font-semibold">No Data Available</h2>
            <p className="text-text-secondary">
              Upload and parse a UAC archive to search through logs. Go to the Dashboard to upload files.
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors" onClick={() => navigate("/")}>
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-3 p-4">
      {/* Compact Header with Filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-primary/10 rounded-lg flex items-center justify-center">
            <SearchIcon className="w-4 h-4 text-brand-primary" />
          </div>
          <h1 className="text-lg font-heading font-semibold">Log Search</h1>
        </div>

        {/* Inline Filters */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          {/* Session selector */}
          <select
            value={effectiveSessionId || ""}
            onChange={(e) => handleSessionSelect(e.target.value)}
            className="px-2 py-1.5 bg-bg-base border border-border-default rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary/50 max-w-[180px]"
          >
            {readySessions.map((s: { session_id: string; original_filename: string }) => (
              <option key={s.session_id} value={s.session_id}>
                {s.original_filename}
              </option>
            ))}
          </select>

          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search logs... (Ctrl+K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              className="pl-8 pr-7 h-8 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          
          <button className="flex items-center gap-1 h-8 px-3 text-xs font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50" onClick={handleSearch} disabled={isLoading}>
            <SearchIcon className="w-3.5 h-3.5" />
            Search
          </button>

          {/* Filter Dropdowns */}
          {filterOptions && (
            <>
              <select
                value={sourceTypeFilter}
                onChange={(e) => { setSourceTypeFilter(e.target.value); setPage(1); }}
                className="px-2 py-1.5 bg-bg-base border border-border-default rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary/50"
              >
                <option value="">Source Type</option>
                {filterOptions.source_types.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              
              <select
                value={categoryFilter}
                onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
                className="px-2 py-1.5 bg-bg-base border border-border-default rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary/50"
              >
                <option value="">Artifact Category</option>
                {filterOptions.artifact_categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </>
          )}

          {(sourceTypeFilter || categoryFilter || activeQuery) && (
            <button
              className="h-8 px-2 text-xs text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
              onClick={() => { 
                setSourceTypeFilter(""); 
                setCategoryFilter(""); 
                setSearchQuery("");
                setActiveQuery("");
                setPage(1); 
              }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Active Filter Chips - More compact */}
      {(sourceTypeFilter || categoryFilter || activeQuery) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-text-muted">Filters:</span>
          {activeQuery && (
            <button
              onClick={() => { setSearchQuery(""); setActiveQuery(""); setPage(1); }}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-primary/10 text-brand-primary rounded-full hover:bg-brand-primary/20 transition-colors"
            >
              <SearchIcon className="w-3 h-3" />
              "{activeQuery}"
              <X className="w-3 h-3 ml-0.5" />
            </button>
          )}
          {sourceTypeFilter && (
            <button
              onClick={() => { setSourceTypeFilter(""); setPage(1); }}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-full hover:bg-blue-500/20 transition-colors"
            >
              {sourceTypeFilter}
              <X className="w-3 h-3 ml-0.5" />
            </button>
          )}
          {categoryFilter && (
            <button
              onClick={() => { setCategoryFilter(""); setPage(1); }}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full hover:bg-purple-500/20 transition-colors"
            >
              {categoryFilter}
              <X className="w-3 h-3 ml-0.5" />
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Spinner className="w-6 h-6 text-brand-primary" />
            <p className="text-text-secondary text-sm">Searching logs...</p>
          </div>
        </div>
      ) : isError ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-red-400">
            <AlertCircle className="w-8 h-8" />
            <p>Failed to search logs. Please try again.</p>
          </div>
        </div>
      ) : data ? (
        <>
          {/* Results stats bar */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">
              Found <span className="font-semibold text-brand-primary">{data.total.toLocaleString()}</span> results
              {activeQuery && (
                <> for "<span className="text-text-primary">{activeQuery}</span>"</>
              )}
              {sourceTypeFilter && (
                <> in <span className="text-blue-400">{sourceTypeFilter}</span></>
              )}
              {categoryFilter && (
                <> / <span className="text-purple-400">{categoryFilter}</span></>
              )}
            </span>
            {data.pages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  disabled={!data.has_prev}
                  onClick={() => setPage(p => p - 1)}
                  className="p-1.5 text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-text-secondary">
                  Page {data.page} of {data.pages}
                </span>
                <button
                  disabled={!data.has_next}
                  onClick={() => setPage(p => p + 1)}
                  className="p-1.5 text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Results list */}
          <div className="flex-1 overflow-auto space-y-3">
            {data.results.length === 0 ? (
              <div className="text-center py-12">
                <SearchIcon className="w-12 h-12 text-text-muted mx-auto mb-3" />
                <p className="text-text-secondary">No results found</p>
                <p className="text-sm text-text-muted mt-1">
                  Try adjusting your search query or filters
                </p>
                
                {/* Suggest other categories when no results */}
                {filterOptions && filterOptions.artifact_categories.length > 0 && categoryFilter && (
                  <div className="mt-6">
                    <p className="text-sm text-text-muted mb-3">Try searching in other categories:</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {filterOptions.artifact_categories
                        .filter(cat => cat !== categoryFilter)
                        .slice(0, 5)
                        .map(cat => (
                          <button
                            key={cat}
                            onClick={() => { setCategoryFilter(cat); setPage(1); }}
                            className="px-3 py-1.5 bg-purple-500/10 text-purple-400 text-xs rounded-full hover:bg-purple-500/20 transition-colors"
                          >
                            {cat}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                {data.results.map((result) => (
                  <ResultCard
                    key={result.chunk_id}
                    result={result}
                    query={activeQuery}
                    isExpanded={expandedChunks.has(result.chunk_id)}
                    onToggle={() => toggleExpanded(result.chunk_id)}
                    onAskAI={handleAskAI}
                  />
                ))}
                
                {/* Related Categories Suggestions */}
                {filterOptions && !categoryFilter && activeQuery && data.results.length > 0 && (
                  <div className="bg-bg-surface border border-border-subtle rounded-xl p-4 mt-4">
                    <p className="text-sm font-medium text-text-secondary mb-3">
                      <Sparkles className="w-4 h-4 inline mr-1.5 text-brand-primary" />
                      Narrow your search by category:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {filterOptions.artifact_categories.slice(0, 8).map(cat => (
                        <button
                          key={cat}
                          onClick={() => { setCategoryFilter(cat); setPage(1); }}
                          className="px-3 py-1.5 bg-bg-base border border-border-default text-text-secondary text-xs rounded-full hover:border-purple-400 hover:text-purple-400 transition-colors"
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bottom pagination */}
          {data.pages > 1 && (
            <div className="flex justify-center gap-2 pt-4 border-t border-border-subtle">
              <button
                disabled={!data.has_prev}
                onClick={() => setPage(p => p - 1)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-bg-elevated text-text-secondary border border-border-default rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <button
                disabled={!data.has_next}
                onClick={() => setPage(p => p + 1)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-bg-elevated text-text-secondary border border-border-default rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      ) : null}

      <ScrollToTop />
    </div>
  );
}
