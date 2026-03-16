import { useState, useEffect } from "react";
import { X, Upload, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, FileArchive, RotateCcw } from "lucide-react";
import { useUploadStore, type UploadJob, STEP_LABELS } from "@/stores/uploadStore";
import { useNavigate } from "react-router-dom";

export function GlobalUploadProgress() {
  const navigate = useNavigate();
  const { jobs, removeJob, clearCompleted } = useUploadStore();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isVisible, setIsVisible] = useState(false);

  const activeJobs = jobs.filter((j) => j.status === "uploading" || j.status === "parsing");
  
  // Warn user before leaving page if uploads are in progress
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (activeJobs.length > 0) {
        e.preventDefault();
        e.returnValue = "Upload in progress. Are you sure you want to leave?";
        return e.returnValue;
      }
    };
    
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [activeJobs.length]);

  // Show/hide based on jobs
  useEffect(() => {
    if (jobs.length > 0) {
      setIsVisible(true);
    } else {
      // Delay hiding to allow completion animation
      const timer = setTimeout(() => setIsVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [jobs.length]);

  if (!isVisible || jobs.length === 0) {
    return null;
  }

  const completedJobs = jobs.filter((j) => j.status === "completed");
  const errorJobs = jobs.filter((j) => j.status === "error");

  const handleJobClick = (job: UploadJob) => {
    if (job.status === "completed" && job.sessionId) {
      navigate("/query");
    }
  };
  
  // Get human-readable step label
  const getStepLabel = (job: UploadJob) => {
    if (job.status === "uploading") return "Uploading...";
    if (job.step && STEP_LABELS[job.step]) {
      return STEP_LABELS[job.step];
    }
    return "Processing...";
  };

  return (
    <div className="fixed top-20 right-4 z-50 w-96 bg-bg-surface border border-border-default rounded-lg shadow-lg overflow-hidden animate-slide-in-right">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-bg-elevated border-b border-border-subtle cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-brand-primary" />
          <span className="font-medium text-sm">
            {activeJobs.length > 0
              ? `Processing ${activeJobs.length} file${activeJobs.length > 1 ? "s" : ""}`
              : `${completedJobs.length + errorJobs.length} upload${jobs.length > 1 ? "s" : ""}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {completedJobs.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearCompleted();
              }}
              className="text-xs text-text-muted hover:text-text-secondary"
            >
              Clear
            </button>
          )}
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          )}
        </div>
      </div>

      {/* Jobs List */}
      {isExpanded && (
        <div className="max-h-80 overflow-y-auto">
          {jobs.map((job) => (
            <div
              key={job.id}
              className={`px-4 py-4 border-b border-border-subtle last:border-b-0 ${
                job.status === "completed" ? "cursor-pointer hover:bg-bg-hover" : ""
              }`}
              onClick={() => handleJobClick(job)}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {job.status === "uploading" || job.status === "parsing" ? (
                    <Loader2 className="w-5 h-5 text-brand-primary animate-spin" />
                  ) : job.status === "completed" ? (
                    <CheckCircle2 className="w-5 h-5 text-success" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-error" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {job.filename}
                    </p>
                    {(job.status === "completed" || job.status === "error") && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeJob(job.id);
                        }}
                        className="text-text-muted hover:text-text-secondary shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  
                  {job.investigationName && (
                    <p className="text-xs text-text-muted flex items-center gap-1 mt-0.5">
                      <FileArchive className="w-3 h-3" />
                      {job.investigationName}
                    </p>
                  )}

                  {(job.status === "uploading" || job.status === "parsing") && (
                    <div className="mt-3">
                      {/* Step indicator */}
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="text-text-secondary font-medium">
                          {getStepLabel(job)}
                        </span>
                        <span className="text-text-muted">{job.progress}%</span>
                      </div>
                      
                      {/* Step detail */}
                      {job.stepDetail && (
                        <p className="text-xs text-text-muted mb-2 truncate" title={job.stepDetail}>
                          {job.stepDetail}
                        </p>
                      )}
                      
                      {/* Progress bar */}
                      <div className="w-full bg-bg-elevated rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-brand-primary h-2 rounded-full transition-all duration-300"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {job.status === "completed" && (
                    <p className="text-xs text-success mt-2">
                      Click to start querying
                    </p>
                  )}

                  {job.status === "error" && job.error && (
                    <div className="mt-2">
                      <p className="text-xs text-error break-words">{job.error}</p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeJob(job.id);
                          navigate("/");
                        }}
                        className="mt-2 text-xs text-brand-primary hover:text-brand-primary-hover flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Retry upload
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Collapsed Progress Summary */}
      {!isExpanded && activeJobs.length > 0 && (
        <div className="px-4 py-2">
          <div className="w-full bg-bg-muted rounded-full h-2 overflow-hidden">
            <div
              className="bg-brand-primary h-2 rounded-full transition-all duration-300"
              style={{
                width: `${
                  activeJobs.reduce((sum, j) => sum + j.progress, 0) / activeJobs.length
                }%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
