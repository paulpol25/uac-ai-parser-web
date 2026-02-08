import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Investigation } from "@/types/investigation";

interface InvestigationState {
  currentInvestigation: Investigation | null;
  investigations: Investigation[];
  setCurrentInvestigation: (investigation: Investigation | null) => void;
  setInvestigations: (investigations: Investigation[]) => void;
  addInvestigation: (investigation: Investigation) => void;
  updateInvestigation: (id: number, updates: Partial<Investigation>) => void;
  removeInvestigation: (id: number) => void;
  clearInvestigation: () => void;
}

export const useInvestigationStore = create<InvestigationState>()(
  persist(
    (set) => ({
      currentInvestigation: null,
      investigations: [],
      setCurrentInvestigation: (investigation) =>
        set({ currentInvestigation: investigation }),
      setInvestigations: (investigations) => set({ investigations }),
      addInvestigation: (investigation) =>
        set((state) => ({
          investigations: [investigation, ...state.investigations],
        })),
      updateInvestigation: (id, updates) =>
        set((state) => ({
          investigations: state.investigations.map((inv) =>
            inv.id === id ? { ...inv, ...updates } : inv
          ),
          currentInvestigation:
            state.currentInvestigation?.id === id
              ? { ...state.currentInvestigation, ...updates }
              : state.currentInvestigation,
        })),
      removeInvestigation: (id) =>
        set((state) => ({
          investigations: state.investigations.filter((inv) => inv.id !== id),
          currentInvestigation:
            state.currentInvestigation?.id === id
              ? null
              : state.currentInvestigation,
        })),
      clearInvestigation: () => set({ currentInvestigation: null }),
    }),
    {
      name: "uac-investigation",
    }
  )
);
