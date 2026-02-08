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
  Activity,
  Layers,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useSessionStore } from "@/stores/sessionStore";
import { useInvestigationStore } from "@/stores/investigationStore";
import { useUploadStore } from "@/stores/uploadStore";
import { useToast } from "@/components/ui/Toast";
import { parseFileWithProgress, getInvestigation, deleteSession, listInvestigations, type ParseProgressEvent } from "@/services/api";
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
    // Auto-refresh every 10s if any session is still processing
    refetchInterval: (query) => {
      const sessions = query.state.data?.sessions || [];
      const hasProcessing = sessions.some((s: { status: string }) => s.status !== "ready");
      return hasProcessing ? 10000 : false;
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

  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const jobId = addJob({
        filename: file.name,
        progress: 0,
        status: "uploading",
        step: "init",
        stepDetail: "Starting upload...",
        investigationId: currentInvestigation?.id,
        investigationName: currentInvestigation?.name,
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
          }
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard 
            icon={FolderOpen} 
            label="Investigations" 
            value={stats.investigations} 
            color="brand"
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

        {/* Welcome Card */}
        <div className="bg-gradient-to-br from-brand-primary/10 via-purple-500/5 to-blue-500/10 border border-brand-primary/20 rounded-2xl p-8 text-center">
          <div className="w-20 h-20 mx-auto bg-bg-surface rounded-2xl flex items-center justify-center mb-6 shadow-lg">
            <Sparkles className="w-10 h-10 text-brand-primary" />
          </div>
          <h1 className="text-2xl font-heading font-bold mb-3">
            Welcome to UAC AI Parser
          </h1>
          <p className="text-text-secondary max-w-md mx-auto mb-6">
            AI-powered forensic analysis for Unix-like systems. Upload UAC archives and let AI help you investigate.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" onClick={() => navigate("/investigations")}>
              <FolderOpen className="w-5 h-5 mr-2" />
              Select Investigation
            </Button>
            <Button size="lg" variant="secondary" onClick={() => navigate("/investigations?create=true")}>
              <Plus className="w-5 h-5 mr-2" />
              Create New
            </Button>
          </div>
        </div>

        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <div className="bg-bg-surface border border-border-subtle rounded-xl">
            <div className="px-5 py-4 border-b border-border-subtle flex items-center gap-2">
              <Activity className="w-4 h-4 text-text-muted" />
              <h3 className="font-semibold text-text-primary">Recent Activity</h3>
            </div>
            <div className="divide-y divide-border-subtle">
              {recentActivity.map((job) => (
                <div key={job.id} className="px-5 py-3 flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    job.status === "completed" ? "bg-success/10" :
                    job.status === "error" ? "bg-error/10" : "bg-blue-500/10"
                  }`}>
                    {job.status === "completed" ? (
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    ) : job.status === "error" ? (
                      <AlertCircle className="w-4 h-4 text-error" />
                    ) : (
                      <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{job.filename}</p>
                    <p className="text-xs text-text-muted">
                      {job.investigationName || "Unknown investigation"}
                      {job.status === "parsing" && ` · ${job.progress}%`}
                    </p>
                  </div>
                  {job.completedAt && (
                    <span className="text-xs text-text-muted">
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

  // Session deletion
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; name: string } | null>(null);
  
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

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6 p-6">
      {/* Left Panel - Investigation Info & Upload */}
      <div className="lg:w-80 xl:w-96 flex-shrink-0 space-y-6">
        {/* Current Investigation */}
        <div className="bg-bg-surface border border-border-subtle rounded-xl p-5">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-primary/10 rounded-lg flex items-center justify-center">
                <FolderOpen className="w-5 h-5 text-brand-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-text-primary">{currentInvestigation.name}</h2>
                {currentInvestigation.case_number && (
                  <p className="text-xs text-text-muted">{currentInvestigation.case_number}</p>
                )}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/investigations")}>
              Change
            </Button>
          </div>
          {currentInvestigation.description && (
            <p className="text-sm text-text-secondary mb-4">{currentInvestigation.description}</p>
          )}
          <div className="flex items-center flex-wrap gap-4 text-sm text-text-muted">
            <span className="flex items-center gap-1">
              <Database className="w-4 h-4" />
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            </span>
            {totalArtifacts > 0 && (
              <span className="flex items-center gap-1">
                <Layers className="w-4 h-4" />
                {totalArtifacts.toLocaleString()} artifacts
              </span>
            )}
          </div>
        </div>

        {/* Upload Area */}
        <div
          className={`
            relative overflow-hidden border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
            ${isDragging 
              ? "border-brand-primary bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 scale-[1.02]" 
              : "border-border-default hover:border-brand-primary/50 hover:bg-bg-elevated/50"}
            ${parseMutation.isPending ? "pointer-events-none" : ""}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {/* Background pattern when dragging */}
          {isDragging && (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.1)_1px,transparent_1px)] bg-[length:20px_20px] pointer-events-none" />
          )}
          
          <input
            ref={fileInputRef}
            type="file"
            accept=".tar.gz,.tgz,.zip"
            onChange={handleFileSelect}
            className="hidden"
          />
          
          <div className={`relative z-10 transition-transform ${isDragging ? "scale-110" : ""}`}>
            <div className={`w-14 h-14 mx-auto mb-4 rounded-xl flex items-center justify-center transition-colors ${
              isDragging ? "bg-brand-primary/20" : "bg-bg-elevated"
            }`}>
              <Upload className={`w-7 h-7 transition-colors ${isDragging ? "text-brand-primary" : "text-text-muted"}`} />
            </div>
            <p className="font-medium text-text-primary mb-1">
              {isDragging ? "Drop to upload" : "Upload UAC Output"}
            </p>
            <p className="text-sm text-text-muted mb-3">
              Drag & drop .tar.gz or .zip file here
            </p>
            <span className="inline-flex items-center gap-1 text-xs text-text-muted bg-bg-elevated px-3 py-1.5 rounded-full">
              <FileArchive className="w-3.5 h-3.5" />
              or click to browse
            </span>
          </div>
        </div>

        {/* Active Uploads */}
        {activeUploads.length > 0 && (
          <div className="space-y-2">
            {activeUploads.map(job => (
              <div key={job.id} className="bg-bg-surface border border-border-subtle rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2">
                  <RefreshCw className="w-4 h-4 text-brand-primary animate-spin" />
                  <span className="text-sm font-medium text-text-primary truncate flex-1">
                    {job.filename}
                  </span>
                  <span className="text-xs text-text-muted">{job.progress}%</span>
                </div>
                <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-brand-primary rounded-full transition-all duration-300"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
                {job.stepDetail && (
                  <p className="text-xs text-text-muted mt-2">{job.stepDetail}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {parseMutation.isError && (
          <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{(parseMutation.error as Error).message}</span>
          </div>
        )}

        {parseMutation.isSuccess && (
          <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-lg text-success text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>File parsed successfully!</span>
          </div>
        )}
      </div>

      {/* Right Panel - Sessions & Quick Actions */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <QuickActionCard
            icon={Sparkles}
            title="AI Query"
            description="Ask questions about your data"
            onClick={() => navigate("/query")}
            color="brand"
            disabled={readySessions.length === 0}
          />
          <QuickActionCard
            icon={Clock}
            title="Timeline"
            description="View events chronologically"
            onClick={() => navigate("/timeline")}
            color="purple"
            disabled={searchableSessions.length === 0}
          />
          <QuickActionCard
            icon={Search}
            title="Log Search"
            description="Search raw log data"
            onClick={() => navigate("/search")}
            color="blue"
            disabled={searchableSessions.length === 0}
          />
        </div>

        {/* Sessions List */}
        <div className="bg-bg-surface border border-border-subtle rounded-xl">
          <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">Data Sources</h3>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => refetchInvestigation()}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
                title="Refresh status"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <span className="text-sm text-text-muted">{sessions.length} total</span>
            </div>
          </div>
          
          {sessions.length === 0 ? (
            <div className="p-8 text-center">
              <FileArchive className="w-12 h-12 mx-auto mb-3 text-text-muted/50" />
              <p className="text-text-secondary mb-1">No data sources yet</p>
              <p className="text-sm text-text-muted">
                Upload a UAC output file to get started
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="px-5 py-4 hover:bg-bg-hover transition-colors flex items-center gap-4"
                >
                  <div 
                    className="flex items-center gap-4 flex-1 min-w-0 cursor-pointer"
                    onClick={() => {
                      setSession(session.session_id);
                      navigate("/query");
                    }}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      session.status === "ready" ? "bg-success/10" :
                      session.status === "searchable" ? "bg-blue-500/10" : "bg-amber-500/10"
                    }`}>
                      <Database className={`w-5 h-5 ${
                        session.status === "ready" ? "text-success" :
                        session.status === "searchable" ? "text-blue-500" : "text-amber-500"
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary truncate">
                        {session.original_filename}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-text-muted">
                        <span>{session.total_artifacts} artifacts</span>
                        {session.hostname && <span>{session.hostname}</span>}
                        {session.os_type && <span>{session.os_type}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {session.status === "ready" ? (
                      <span className="text-xs px-2 py-1 rounded bg-success/10 text-success">
                        Ready
                      </span>
                    ) : (
                      <span className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                        session.status === "searchable" 
                          ? "bg-blue-500/10 text-blue-500" 
                          : "bg-amber-500/10 text-amber-500"
                      }`}>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        {session.status === "searchable" ? "Embedding" : session.status}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSessionToDelete({ id: session.session_id, name: session.original_filename });
                      }}
                      className="p-1.5 rounded hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                      title="Delete session"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <ChevronRight className="w-5 h-5 text-text-muted" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
  description,
  onClick,
  color,
  disabled,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
  color: "brand" | "purple" | "blue";
  disabled?: boolean;
}) {
  const colors = {
    brand: "bg-brand-primary/10 text-brand-primary group-hover:bg-brand-primary/20",
    purple: "bg-purple-500/10 text-purple-500 group-hover:bg-purple-500/20",
    blue: "bg-blue-500/10 text-blue-500 group-hover:bg-blue-500/20",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        group text-left p-4 bg-bg-surface border border-border-subtle rounded-xl 
        transition-all hover:border-border-strong hover:shadow-sm
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
      `}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 transition-colors ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="font-medium text-text-primary">{title}</p>
      <p className="text-xs text-text-muted mt-0.5">{description}</p>
    </button>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color = "brand",
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color?: "brand" | "purple" | "blue" | "green";
  onClick?: () => void;
}) {
  const colors = {
    brand: "bg-brand-primary/10 text-brand-primary",
    purple: "bg-purple-500/10 text-purple-500",
    blue: "bg-blue-500/10 text-blue-500",
    green: "bg-success/10 text-success",
  };

  return (
    <div 
      className={`bg-bg-surface border border-border-subtle rounded-xl p-4 flex items-center gap-4 ${
        onClick ? "cursor-pointer hover:border-border-strong transition-colors" : ""
      }`}
      onClick={onClick}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-text-primary">{value}</p>
        <p className="text-xs text-text-muted">{label}</p>
      </div>
    </div>
  );
}
