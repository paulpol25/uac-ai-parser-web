import { create } from "zustand";

export interface Agent {
  id: string;
  investigation_id: number;
  hostname: string | null;
  os_info: string | null;
  ip_address: string | null;
  status: "registered" | "idle" | "collecting" | "uploading" | "offline" | "error";
  agent_version: string | null;
  last_heartbeat: string | null;
  registered_at: string | null;
  config: Record<string, unknown>;
}

export interface AgentCommand {
  id: string;
  agent_id: string;
  type: string;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  result: Record<string, unknown> | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface AgentState {
  agents: Agent[];
  selectedAgent: Agent | null;
  setAgents: (agents: Agent[]) => void;
  setSelectedAgent: (agent: Agent | null) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  removeAgent: (id: string) => void;
}

export const useAgentStore = create<AgentState>()((set) => ({
  agents: [],
  selectedAgent: null,
  setAgents: (agents) => set({ agents }),
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
  updateAgent: (id, updates) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? { ...a, ...updates } : a)),
      selectedAgent:
        state.selectedAgent?.id === id
          ? { ...state.selectedAgent, ...updates }
          : state.selectedAgent,
    })),
  removeAgent: (id) =>
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== id),
      selectedAgent: state.selectedAgent?.id === id ? null : state.selectedAgent,
    })),
}));
