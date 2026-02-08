import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ArtifactSummary {
  total_artifacts: number;
  categories: Record<string, number>;
}

interface SessionState {
  sessionId: string | null;
  summary: ArtifactSummary | null;
  setSession: (id: string) => void;
  setSummary: (summary: ArtifactSummary) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      sessionId: null,
      summary: null,
      setSession: (id) => set({ sessionId: id }),
      setSummary: (summary) => set({ summary }),
      clearSession: () => set({ sessionId: null, summary: null }),
    }),
    {
      name: "uac-session",
    }
  )
);
