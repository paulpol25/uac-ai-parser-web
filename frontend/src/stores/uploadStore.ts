import { create } from "zustand";

export interface UploadJob {
  id: string;
  filename: string;
  progress: number;
  status: "uploading" | "parsing" | "completed" | "error";
  step?: string;  // Current step: init, hash, extract, sysinfo, artifacts, ingest, chunk, embed, finalize
  stepDetail?: string;  // Human-readable detail for current step
  error?: string;
  investigationId?: number;
  investigationName?: string;
  sessionId?: string;
  startedAt: Date;
  completedAt?: Date;
  abortController?: AbortController;
}

// Human-readable step names
export const STEP_LABELS: Record<string, string> = {
  init: "Initializing",
  hash: "Calculating hash",
  database: "Creating session",
  extract: "Extracting archive",
  sysinfo: "Reading system info",
  artifacts: "Scanning artifacts",
  ingest: "Preparing indexer",
  scan: "Scanning files",
  chunk: "Chunking files",
  commit: "Saving to database",
  searchable: "Search ready",
  embed: "Generating embeddings",
  finalize: "Finalizing",
  complete: "Complete"
};

interface UploadState {
  jobs: UploadJob[];
  addJob: (job: Omit<UploadJob, "id" | "startedAt">) => string;
  updateJob: (id: string, updates: Partial<UploadJob>) => void;
  removeJob: (id: string) => void;
  cancelJob: (id: string) => void;
  clearCompleted: () => void;
  getActiveJobs: () => UploadJob[];
}

export const useUploadStore = create<UploadState>((set, get) => ({
  jobs: [],
  
  addJob: (job) => {
    const id = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newJob: UploadJob = {
      ...job,
      id,
      startedAt: new Date(),
    };
    set((state) => ({ jobs: [...state.jobs, newJob] }));
    return id;
  },
  
  updateJob: (id, updates) => {
    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id ? { ...job, ...updates } : job
      ),
    }));
  },
  
  removeJob: (id) => {
    set((state) => ({
      jobs: state.jobs.filter((job) => job.id !== id),
    }));
  },
  
  cancelJob: (id) => {
    const job = get().jobs.find((j) => j.id === id);
    if (job?.abortController) {
      job.abortController.abort();
    }
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.id === id ? { ...j, status: "error" as const, error: "Cancelled by user" } : j
      ),
    }));
  },
  
  clearCompleted: () => {
    set((state) => ({
      jobs: state.jobs.filter((job) => job.status !== "completed" && job.status !== "error"),
    }));
  },
  
  getActiveJobs: () => {
    return get().jobs.filter((job) => job.status === "uploading" || job.status === "parsing");
  },
}));
