import { useState, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Upload, 
  FolderOpen, 
  Sparkles, 
  Clock, 
  Search,
  ChevronRight,
  Database,
  AlertCircle,
  CheckCircle2,
  FileArchive,
  Plus,
  Trash2,
  StopCircle,
  Cpu,
  Activity,
  Layers,
  RefreshCw,
  Shield,
  Terminal,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Loader";
import { useSessionStore } from "@/stores/sessionStore";
import { useInvestigationStore } from "@/stores/investigationStore";
import { useUploadStore } from "@/stores/uploadStore";
import { isViewer } from "@/stores/authStore";
import { useToast } from "@/components/ui/Toast";
import { parseFileWithProgress, getInvestigation, deleteSession, cancelParse, triggerEmbed, listInvestigations, type ParseProgressEvent } from "@/services/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// Type for parse result
interface ParseResult {
  session_id: string;
  summary: {
    total_artifacts: number;
    categories: Record<string, number>;
  };
}

export function Dashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { setSession, setSummary } = useSessionStore();
  const { currentInvestigation } = useInvestigationStore();
  const { addJob, updateJob, jobs } = useUploadStore();
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all investigations for stats
  const { data: allInvestigationsData } = useQuery({
    queryKey: ["investigations"],
    queryFn: listInvestigations,
    staleTime: 30000,
  });

  // Fetch investigation details with sessions
  const { data: investigationDetail, refetch: refetchInvestigation } = useQuery({
    queryKey: ["investigation", currentInvestigation?.id],
    queryFn: () => currentInvestigation ? getInvestigation(currentInvestigation.id) : null,
    enabled: !!currentInvestigation,
    refetchOnMount: "always",  // Ensure fresh session data
    // Auto-refresh every 10s while processing, 30s otherwise to catch new sessions
    refetchInterval: (query) => {
      const sessions = query.state.data?.sessions || [];
      const hasProcessing = sessions.some((s: { status: string }) => s.status !== "ready");
      return hasProcessing ? 10000 : 30000;
    },
  });

  // Calculate stats
  const stats = useMemo(() => {
    const allInvestigations = allInvestigationsData?.investigations || [];
    const activeInvestigations = allInvestigations.filter(inv => inv.status === "active");
    const totalSessions = activeInvestigations.reduce((acc, inv) => acc + (inv.session_count || 0), 0);
    const totalQueries = activeInvestigations.reduce((acc, inv) => acc + (inv.query_count || 0), 0);
    
    return {
      investigations: allInvestigations.length,
      activeInvestigations: activeInvestigations.length,
      sessions: totalSessions,
      queries: totalQueries,
    };
  }, [allInvestigationsData]);

  // Recent activity from upload jobs
  const recentActivity = useMemo(() => {
    return [...jobs]
      .sort((a, b) => {
        const dateA = a.completedAt || new Date();
        const dateB = b.completedAt || new Date();
        return dateB.getTime() - dateA.getTime();
      })
      .slice(0, 5);
  }, [jobs]);

  // Session deletion - hooks must be before any early returns
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; name: string } | null>(null);

  const embedMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      await triggerEmbed(sessionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["investigation", currentInvestigation?.id] });
      addToast({ type: "success", title: "Embedding Started", message: "Vector embeddings are being generated in the background." });
    },
    onError: (error) => {
      addToast({ type: "error", title: "Embed Failed", message: (error as Error).message });
    },
  });

  const cancelParseMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      await cancelParse(sessionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["investigation", currentInvestigation?.id] });
      addToast({ type: "success", title: "Cancelling", message: "Parse job is being cancelled." });
    },
    onError: (error) => {
      addToast({ type: "error", title: "Cancel Failed", message: (error as Error).message });
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      if (!currentInvestigation) throw new Error("No investigation selected");
      await deleteSession(currentInvestigation.id, sessionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["investigation", currentInvestigation?.id] });
      addToast({
        type: "success",
        title: "Session Deleted",
        message: "The data source has been removed from this investigation.",
      });
      setSessionToDelete(null);
    },
    onError: (error) => {
      addToast({
        type: "error",
        title: "Delete Failed",
        message: (error as Error).message || "Failed to delete session",
      });
    },
  });

  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const abortController = new AbortController();
      const jobId = addJob({
        filename: file.name,
        progress: 0,
        status: "uploading",
        step: "init",
        stepDetail: "Starting upload...",
        investigationId: currentInvestigation?.id,
        investigationName: currentInvestigation?.name,
        abortController,
      });
      
      // Track upload progress locally
      let uploadProgress = 0;
      let uploadComplete = false;
      let searchableNotified = false;
      
      const uploadInterval = setInterval(() => {
        if (!uploadComplete && uploadProgress < 10) {
          uploadProgress = Math.min(uploadProgress + 2, 10);
          updateJob(jobId, {
            progress: uploadProgress,
            stepDetail: "Uploading file...",
          });
        }
      }, 200);
      
      try {
        const result = await parseFileWithProgress(
          file, 
          currentInvestigation?.id,
          (event: ParseProgressEvent) => {
            uploadComplete = true;
            clearInterval(uploadInterval);
            
            if (event.type === "progress" && event.progress !== undefined) {
              updateJob(jobId, {
                status: "parsing",
                progress: event.progress,
                step: event.step,
                stepDetail: event.detail,
                sessionId: event.session_id,  // Store session_id as soon as we have it
              });
              
              // Show toast when timeline/search becomes ready
              if (event.step === "searchable" && !searchableNotified) {
                searchableNotified = true;
                // Set session in store so Timeline/Search pages can use it immediately
                if (event.session_id) {
                  setSession(event.session_id);
                }
                addToast({
                  type: "success",
                  title: "Timeline & Search Ready",
                  message: `${file.name} is now searchable. AI embeddings still processing.`,
                  duration: 5000,
                  action: {
                    label: "Go to Timeline",
                    onClick: () => navigate("/timeline"),
                  },
                });
                // Refresh investigation to show updated status
                queryClient.invalidateQueries({ queryKey: ["investigation", currentInvestigation?.id] });
              }
            }
          },
          abortController.signal
        );
        
        clearInterval(uploadInterval);
        
        // Type assertion for the result
        const parseResult = result as ParseResult;
        
        updateJob(jobId, {
          status: "completed",
          progress: 100,
          step: "complete",
          stepDetail: "Complete!",
          sessionId: parseResult.session_id,
          completedAt: new Date(),
        });
        
        return parseResult;
      } catch (error) {
        clearInterval(uploadInterval);
        
        updateJob(jobId, {
          status: "error",
          error: (error as Error).message,
        });
        throw error;
      }
    },
    onSuccess: (data) => {
      setSession(data.session_id);
      setSummary(data.summary);
      // Refresh investigation list
      queryClient.invalidateQueries({ queryKey: ["investigation", currentInvestigation?.id] });
      queryClient.invalidateQueries({ queryKey: ["investigations"] });
      addToast({
        type: "success",
        title: "Upload Complete",
        message: "All processing finished. AI queries are now available.",
        action: {
          label: "Start Querying",
          onClick: () => navigate("/query"),
        },
      });
    },
  });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = e.dataTransfer.files;
      if (files.length > 0 && currentInvestigation) {
        parseMutation.mutate(files[0]);
      }
    },
    [parseMutation, currentInvestigation]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0 && currentInvestigation) {
        parseMutation.mutate(files[0]);
      }
    },
    [parseMutation, currentInvestigation]
  );

  // No investigation selected - show selection prompt with stats
  if (!currentInvestigation) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-6">
        {/* Stats Overview */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard 
            icon={FolderOpen} 
            label="Investigations" 
            value={stats.investigations} 
            color="cyan"
            onClick={() => navigate("/investigations")}
          />
          <StatCard 
            icon={Database} 
            label="Data Sources" 
            value={stats.sessions} 
            color="blue"
          />
          <StatCard 
            icon={Sparkles} 
            label="AI Queries" 
            value={stats.queries} 
            color="purple"
          />
          <StatCard 
            icon={Activity} 
            label="Active" 
            value={stats.activeInvestigations} 
            color="green"
          />
        </div>

        {/* Welcome Hero */}
        <div className="relative overflow-hidden bg-bg-surface border border-border-subtle rounded-2xl p-8">
          {/* Background grid pattern */}
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: `linear-gradient(#00D9FF 1px, transparent 1px), linear-gradient(90deg, #00D9FF 1px, transparent 1px)`,
            backgroundSize: '40px 40px'
          }} />
          <div className="relative z-10 text-center max-w-lg mx-auto">
            <div className="w-16 h-16 mx-auto bg-brand-primary/10 rounded-2xl flex items-center justify-center mb-5 border border-brand-primary/20">
              <Shield className="w-8 h-8 text-brand-primary" />
            </div>
            <h1 className="text-2xl font-heading font-bold mb-2 text-text-primary">
              UAC AI Forensic Platform
            </h1>
            <p className="text-text-muted text-sm mb-6 leading-relaxed">
              Upload UAC archives and leverage AI to investigate Unix-like systems. Get intelligent insights, detect anomalies, and accelerate incident response.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => navigate("/investigations")}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-primary text-bg-base text-sm font-semibold rounded-lg hover:bg-brand-primary-hover transition-colors shadow-lg shadow-brand-primary/20"
              >
                <FolderOpen className="w-4 h-4" />
                Select Investigation
              </button>
              <button
                onClick={() => navigate("/investigations?create=true")}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-bg-elevated border border-border-subtle text-text-primary text-sm font-medium rounded-lg hover:bg-bg-hover transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create New
              </button>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-text-muted" />
              <h3 className="text-sm font-semibold text-text-primary">Recent Activity</h3>
            </div>
            <div className="divide-y divide-border-subtle">
              {recentActivity.map((job) => (
                <div key={job.id} className="px-4 py-3 flex items-center gap-3">
                  <div className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center",
                    job.status === "completed" && "bg-success/10",
                    job.status === "error" && "bg-error/10",
                    job.status !== "completed" && job.status !== "error" && "bg-blue-500/10"
                  )}>
                    {job.status === "completed" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                    ) : job.status === "error" ? (
                      <AlertCircle className="w-3.5 h-3.5 text-error" />
                    ) : (
                      <Spinner size={14} className="text-blue-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">{job.filename}</p>
                    <p className="text-[10px] text-text-muted">
                      {job.investigationName || "Unknown investigation"}
                      {job.status === "parsing" && ` · ${job.progress}%`}
                    </p>
                  </div>
                  {job.completedAt && (
                    <span className="text-[10px] text-text-muted font-mono">
                      {new Date(job.completedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const sessions = investigationDetail?.sessions || [];
  const readySessions = sessions.filter(s => s.status === "ready");
  // Sessions that have timeline/search available (searchable or ready)
  const searchableSessions = sessions.filter(s => s.status === "ready" || s.status === "searchable");
  
  // Calculate session stats
  const totalArtifacts = sessions.reduce((acc, s) => acc + (s.total_artifacts || 0), 0);

  // Active uploads for current investigation
  const activeUploads = jobs.filter(
    job => job.investigationId === currentInvestigation?.id && 
           (job.status === "uploading" || job.status === "parsing")
  );

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      {/* Top: Investigation Info + Stats Row */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Current Investigation Card */}
        <div className="flex-1 bg-bg-surface border border-border-subtle rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-brand-primary/10 rounded-lg flex items-center justify-center">
                <FolderOpen className="w-4.5 h-4.5 text-brand-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-sm text-text-primary">{currentInvestigation.name}</h2>
                {currentInvestigation.case_number && (
                  <p className="text-[10px] text-text-muted font-mono">{currentInvestigation.case_number}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => navigate("/investigations")}
              className="text-xs text-text-muted hover:text-brand-primary transition-colors"
            >
              Change
            </button>
          </div>
          {currentInvestigation.description && (
            <p className="text-xs text-text-muted mb-3 line-clamp-2">{currentInvestigation.description}</p>
          )}
          <div className="flex items-center flex-wrap gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <Database className="w-3.5 h-3.5" />
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            </span>
            {totalArtifacts > 0 && (
              <span className="flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" />
                {totalArtifacts.toLocaleString()} artifacts
              </span>
            )}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-3 lg:w-[380px]">
          <MiniStat icon={Database} value={sessions.length} label="Sessions" />
          <MiniStat icon={Layers} value={totalArtifacts} label="Artifacts" />
          <MiniStat icon={CheckCircle2} value={readySessions.length} label="Ready" accent />
        </div>
      </div>

      {/* Upload + Quick Actions Row */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-5">
        {/* Upload Area */}
        <div
          className={cn(
            "relative overflow-hidden border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer",
            isDragging
              ? "border-brand-primary bg-brand-primary/5 scale-[1.01]"
              : "border-border-default hover:border-brand-primary/40 hover:bg-bg-surface/50",
            (parseMutation.isPending || isViewer()) && "pointer-events-none opacity-50"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {isDragging && (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,217,255,0.05)_1px,transparent_1px)] bg-[length:20px_20px] pointer-events-none" />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".tar.gz,.tgz,.zip"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className={cn("relative z-10 transition-transform", isDragging && "scale-105")}>
            <div className={cn(
              "w-12 h-12 mx-auto mb-3 rounded-xl flex items-center justify-center transition-colors",
              isDragging ? "bg-brand-primary/15" : "bg-bg-elevated"
            )}>
              <Upload className={cn("w-6 h-6 transition-colors", isDragging ? "text-brand-primary" : "text-text-muted")} />
            </div>
            <p className="text-sm font-medium text-text-primary mb-0.5">
              {isDragging ? "Drop to upload" : "Upload UAC Output"}
            </p>
            <p className="text-xs text-text-muted">
              Drag & drop .tar.gz or .zip — or click to browse
            </p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-row lg:flex-col gap-2 lg:w-44">
          <QuickActionCard
            icon={Sparkles}
            title="AI Query"
            onClick={() => navigate("/query")}
            disabled={readySessions.length === 0}
          />
          <QuickActionCard
            icon={Clock}
            title="Timeline"
            onClick={() => navigate("/timeline")}
            disabled={searchableSessions.length === 0}
          />
          <QuickActionCard
            icon={Search}
            title="Log Search"
            onClick={() => navigate("/search")}
            disabled={searchableSessions.length === 0}
          />
        </div>
      </div>

      {/* Active Uploads */}
      {activeUploads.length > 0 && (
        <div className="space-y-2">
          {activeUploads.map(job => (
            <div key={job.id} className="bg-bg-surface border border-border-subtle rounded-lg p-3">
              <div className="flex items-center gap-3 mb-2">
                <Spinner size={14} className="text-brand-primary" />
                <span className="text-xs font-medium text-text-primary truncate flex-1">
                  {job.filename}
                </span>
                <span className="text-[10px] text-text-muted font-mono">{job.progress}%</span>
              </div>
              <div className="h-1 bg-bg-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-primary rounded-full transition-all duration-300"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
              {job.stepDetail && (
                <p className="text-[10px] text-text-muted mt-1.5 font-mono">{job.stepDetail}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {parseMutation.isError && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{(parseMutation.error as Error).message}</span>
        </div>
      )}

      {parseMutation.isSuccess && (
        <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-lg text-success text-xs">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>File parsed successfully!</span>
        </div>
      )}

      {/* Sessions List */}
      <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">Data Sources</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetchInvestigation()}
              className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
              title="Refresh status"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-text-muted font-mono">{sessions.length} total</span>
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="p-8 text-center">
            <FileArchive className="w-10 h-10 mx-auto mb-2 text-text-muted/30" />
            <p className="text-xs text-text-muted">No data sources yet — upload a UAC file to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="px-4 py-3 hover:bg-bg-hover/50 transition-colors flex items-center gap-3 group"
              >
                <div
                  className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                  onClick={() => {
                    setSession(session.session_id);
                    navigate("/query");
                  }}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center",
                    session.status === "ready" && "bg-success/10",
                    session.status === "searchable" && "bg-blue-500/10",
                    session.status !== "ready" && session.status !== "searchable" && "bg-amber-500/10"
                  )}>
                    <Database className={cn(
                      "w-4 h-4",
                      session.status === "ready" && "text-success",
                      session.status === "searchable" && "text-blue-500",
                      session.status !== "ready" && session.status !== "searchable" && "text-amber-500"
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">
                      {session.original_filename}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-text-muted">
                      <span>{session.total_artifacts} artifacts</span>
                      {session.hostname && <span>· {session.hostname}</span>}
                      {session.os_type && <span>· {session.os_type}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {session.status === "ready" ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">
                      Ready
                    </span>
                  ) : (
                    <span className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 font-medium",
                      session.status === "searchable"
                        ? "bg-blue-500/10 text-blue-500"
                        : "bg-amber-500/10 text-amber-500"
                    )}>
                      <Spinner size={10} />
                      {session.status === "searchable" ? "Embedding" : session.status}
                    </span>
                  )}
                  {!isViewer() && session.status === "processing" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelParseMutation.mutate(session.session_id);
                      }}
                      className="p-1 rounded hover:bg-amber-500/10 text-text-muted hover:text-amber-500 transition-colors opacity-0 group-hover:opacity-100"
                      title="Cancel parse"
                      disabled={cancelParseMutation.isPending}
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {!isViewer() && session.status === "ready" && !session.has_embeddings && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        embedMutation.mutate(session.session_id);
                      }}
                      className="p-1 rounded hover:bg-purple-500/10 text-text-muted hover:text-purple-500 transition-colors opacity-0 group-hover:opacity-100"
                      title="Generate vector embeddings for semantic search"
                      disabled={embedMutation.isPending}
                    >
                      <Cpu className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {!isViewer() && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSessionToDelete({ id: session.session_id, name: session.original_filename });
                    }}
                    className="p-1 rounded hover:bg-error/10 text-text-muted hover:text-error transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete session"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  )}
                  <ChevronRight className="w-4 h-4 text-text-muted/50" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Session Confirmation */}
      <ConfirmDialog
        isOpen={!!sessionToDelete}
        onClose={() => setSessionToDelete(null)}
        onConfirm={() => sessionToDelete && deleteSessionMutation.mutate(sessionToDelete.id)}
        title="Delete Data Source"
        message={`Are you sure you want to delete "${sessionToDelete?.name}"? This will remove all parsed data and analysis for this file.`}
        variant="danger"
        confirmLabel="Delete"
        isLoading={deleteSessionMutation.isPending}
      />
    </div>
  );
}

function QuickActionCard({
  icon: Icon,
  title,
  onClick,
  disabled,
}: {
  icon: React.ElementType;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex-1 lg:flex-none flex items-center gap-2 px-3 py-2.5 bg-bg-surface border border-border-subtle rounded-lg",
        "transition-all hover:border-brand-primary/30 hover:bg-bg-hover text-left",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      <Icon className="w-4 h-4 text-brand-primary" />
      <span className="text-xs font-medium text-text-primary">{title}</span>
      <ChevronRight className="w-3 h-3 text-text-muted/50 ml-auto" />
    </button>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color = "cyan",
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color?: "cyan" | "purple" | "blue" | "green";
  onClick?: () => void;
}) {
  const colors = {
    cyan: "bg-brand-primary/10 text-brand-primary",
    purple: "bg-purple-500/10 text-purple-500",
    blue: "bg-blue-500/10 text-blue-500",
    green: "bg-success/10 text-success",
  };

  return (
    <div 
      className={cn(
        "bg-bg-surface border border-border-subtle rounded-xl p-3 flex items-center gap-3",
        onClick && "cursor-pointer hover:border-brand-primary/30 transition-colors"
      )}
      onClick={onClick}
    >
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", colors[color])}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-xl font-bold text-text-primary font-heading">{value}</p>
        <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-bg-surface border border-border-subtle rounded-lg p-3 text-center">
      <Icon className={cn("w-4 h-4 mx-auto mb-1", accent ? "text-success" : "text-text-muted")} />
      <p className="text-lg font-bold text-text-primary font-heading">{value.toLocaleString()}</p>
      <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
    </div>
  );
}
