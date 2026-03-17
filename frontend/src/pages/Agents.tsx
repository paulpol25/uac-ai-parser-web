import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Play,
  Terminal,
  RefreshCw,
  Download,
  Shield,
  Search,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Server,
  Globe,
  Cpu,
  Heart,
  Bug,
  Network,
  HardDrive,
  MemoryStick,
  Settings2,
  Link2,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { Spinner } from "@/components/ui/Loader";
import { useToastHelpers } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInvestigationStore } from "@/stores/investigationStore";
import { useAgentStore, type Agent, type AgentCommand } from "@/stores/agentStore";
import { getAuthHeader } from "@/stores/authStore";
import {
  listAgents,
  registerAgent,
  deleteAgent,
  dispatchCommand,
  listCommands,
  listAgentEvents,
  listInvestigations,
  getSheetstormStatus,
  syncToSheetstorm,
  downloadAgentFile,
} from "@/services/api";

/* ── Status Palette ── */
const STATUS_COLORS: Record<string, string> = {
  registered: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  idle: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  collecting: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  uploading: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  offline: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  error: "bg-red-500/20 text-red-400 border-red-500/30",
};
const STATUS_DOT: Record<string, string> = {
  registered: "bg-yellow-400",
  idle: "bg-emerald-400",
  collecting: "bg-blue-400",
  uploading: "bg-cyan-400",
  offline: "bg-zinc-500",
  error: "bg-red-400",
};
const CMD_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  running: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  cancelled: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

/* ── Quick Checks (for Console tab) ── */
const QUICK_CHECKS = [
  { id: "processes", label: "Hidden Process Check", icon: Bug },
  { id: "modules", label: "Kernel Audit Scan", icon: Cpu },
  { id: "connections", label: "Network Connections", icon: Network },
  { id: "mounts", label: "File System Scan", icon: HardDrive },
  { id: "env", label: "Memory Dump", icon: MemoryStick },
  { id: "history", label: "Run Custom Check", icon: Settings2 },
] as const;

/* ════════════════════════════════════════════
   Main Page
   ════════════════════════════════════════════ */
export function Agents() {
  const queryClient = useQueryClient();
  const toast = useToastHelpers();
  const { currentInvestigation } = useInvestigationStore();
  const { selectedAgent, setSelectedAgent } = useAgentStore();

  const [showDeployModal, setShowDeployModal] = useState(false);
  const [deployMode, setDeployMode] = useState<"new" | "redeploy">("new");
  const [selectedInvId, setSelectedInvId] = useState<number>(currentInvestigation?.id ?? 0);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; agent: Agent | null }>({
    isOpen: false,
    agent: null,
  });
  const [commandType, setCommandType] = useState("run_check");
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [expandedInvs, setExpandedInvs] = useState<Set<number>>(new Set());

  // Smart payload fields
  const [checkName, setCheckName] = useState("processes");
  const [shellCommand, setShellCommand] = useState("");
  const [filePath, setFilePath] = useState("");
  const [uacProfile, setUacProfile] = useState("");

  // Queries
  const { data: investigationsData } = useQuery({
    queryKey: ["investigations"],
    queryFn: listInvestigations,
  });
  const investigations = investigationsData?.investigations ?? [];

  const { data: agentsData, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: () => listAgents(),
    refetchInterval: 10000,
  });
  const agents: Agent[] = agentsData?.agents ?? [];

  const { data: commandsData } = useQuery({
    queryKey: ["agent-commands", selectedAgent?.id],
    queryFn: () => (selectedAgent ? listCommands(selectedAgent.id) : null),
    enabled: !!selectedAgent,
    refetchInterval: 5000,
  });
  const commands: AgentCommand[] = commandsData?.commands ?? [];

  const { data: eventsData } = useQuery({
    queryKey: ["agent-events", selectedAgent?.id],
    queryFn: () => (selectedAgent ? listAgentEvents(selectedAgent.id) : null),
    enabled: !!selectedAgent,
  });
  const events = eventsData?.events ?? [];

  // Group agents by investigation
  const agentsByInv = useMemo(() => {
    const map = new Map<number, Agent[]>();
    const q = sidebarSearch.toLowerCase();
    for (const a of agents) {
      if (q && !(a.hostname ?? "").toLowerCase().includes(q) && !a.id.toLowerCase().includes(q))
        continue;
      const list = map.get(a.investigation_id) ?? [];
      list.push(a);
      map.set(a.investigation_id, list);
    }
    return map;
  }, [agents, sidebarSearch]);

  const unassignedAgents = useMemo(
    () => agents.filter((a) => !a.investigation_id && (
      !sidebarSearch || (a.hostname ?? "").toLowerCase().includes(sidebarSearch.toLowerCase()) || a.id.toLowerCase().includes(sidebarSearch.toLowerCase())
    )),
    [agents, sidebarSearch]
  );

  // Mutations
  const registerMutation = useMutation({
    mutationFn: (invId: number) => registerAgent(invId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast.success("Agent registered — copy the deploy command below.");
      // Select the new agent and switch the modal to show the deploy command
      setSelectedAgent(data.agent);
      setExpandedInvs((prev) => new Set(prev).add(data.agent.investigation_id));
      setDeployMode("redeploy");
    },
    onError: () => toast.error("Failed to register agent"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAgent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      if (selectedAgent?.id === deleteConfirm.agent?.id) setSelectedAgent(null);
      toast.success("Agent deleted");
    },
  });

  const commandMutation = useMutation({
    mutationFn: ({ agentId, type, payload }: { agentId: string; type: string; payload?: Record<string, unknown> }) =>
      dispatchCommand(agentId, type, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-commands"] });
      toast.success("Command dispatched");
    },
    onError: () => toast.error("Failed to dispatch command"),
  });

  const handleDispatch = (type?: string, payload?: Record<string, unknown>) => {
    if (!selectedAgent) return;
    const t = type ?? commandType;
    let p = payload;

    if (!p) {
      switch (t) {
        case "run_check":
          p = { check: checkName };
          break;
        case "exec_command":
          if (!shellCommand.trim()) { toast.error("Enter a shell command"); return; }
          p = { command: shellCommand };
          break;
        case "collect_file":
          if (!filePath.trim()) { toast.error("Enter a file path"); return; }
          p = { path: filePath };
          break;
        case "run_uac":
          p = uacProfile.trim() ? { profile: uacProfile } : undefined;
          break;
        case "shutdown":
          p = undefined;
          break;
      }
    }
    commandMutation.mutate({ agentId: selectedAgent.id, type: t, payload: p });
  };

  const toggleInv = (invId: number) => {
    setExpandedInvs((prev) => {
      const next = new Set(prev);
      next.has(invId) ? next.delete(invId) : next.add(invId);
      return next;
    });
  };

  return (
    <div className="flex h-full">
      {/* ── Sidebar ── */}
      <div className="w-72 shrink-0 border-r border-border-subtle bg-bg-base flex flex-col">
        {/* Search */}
        <div className="p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search agents..."
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-bg-elevated pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-brand-primary/50 focus:outline-none"
            />
          </div>
        </div>

        {/* Investigation Tree */}
        <ScrollArea className="flex-1 px-2 pb-2">
          <div className="space-y-0.5">
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Active Investigations
            </div>

            {isLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
              <>
                {investigations.map((inv) => {
                  const invAgents = agentsByInv.get(inv.id) ?? [];
                  const isExpanded = expandedInvs.has(inv.id);
                  return (
                    <div key={inv.id}>
                      <div className="flex items-center group">
                        <button
                          onClick={() => toggleInv(inv.id)}
                          className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-bg-hover transition-colors min-w-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0" />
                          )}
                          <span className="truncate font-medium">{inv.name}</span>
                          {invAgents.length > 0 && (
                            <span className="ml-auto text-[10px] text-text-muted">{invAgents.length}</span>
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedInvId(inv.id);
                            setDeployMode("new");
                            setShowDeployModal(true);
                          }}
                          className="shrink-0 rounded-md p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:bg-bg-hover hover:text-emerald-400 transition-all mr-1"
                          title="Register new agent for this investigation"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      {isExpanded && invAgents.length > 0 && (
                        <div className="ml-3 space-y-0.5 border-l border-border-subtle pl-2">
                          {invAgents.map((agent) => (
                            <AgentSidebarItem
                              key={agent.id}
                              agent={agent}
                              isSelected={selectedAgent?.id === agent.id}
                              onSelect={() => setSelectedAgent(agent)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Agent Pool (unassigned) */}
                {unassignedAgents.length > 0 && (
                  <div>
                    <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted mt-3">
                      Agent Pool
                    </div>
                    <div className="space-y-0.5">
                      {unassignedAgents.map((agent) => (
                        <AgentSidebarItem
                          key={agent.id}
                          agent={agent}
                          isSelected={selectedAgent?.id === agent.id}
                          onSelect={() => setSelectedAgent(agent)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {agents.length === 0 && (
                  <div className="px-2 py-6 text-center text-xs text-text-muted">
                    No agents deployed yet.
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedAgent ? (
          <>
            {/* Top Bar */}
            <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3 gap-4 min-w-0">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-text-primary font-heading flex items-center gap-2 min-w-0">
                  <span className="shrink-0">Agent:</span>
                  <span className="truncate">{selectedAgent.hostname || selectedAgent.id.slice(0, 12)}</span>
                </h2>
                <p className="text-xs text-text-muted font-mono mt-0.5 truncate">{selectedAgent.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDeleteConfirm({ isOpen: true, agent: selectedAgent })}
                  className="flex items-center gap-1.5 rounded-lg border border-red-800/60 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
                <button
                  onClick={() => {
                    setSelectedInvId(selectedAgent.investigation_id || (investigations[0]?.id ?? 0));
                    setDeployMode("redeploy");
                    setShowDeployModal(true);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
                  title="View deploy command for this agent"
                >
                  <Terminal className="h-3.5 w-3.5" /> Redeploy
                </button>
                <button
                  onClick={() => {
                    setSelectedInvId(selectedAgent.investigation_id || (investigations[0]?.id ?? 0));
                    setDeployMode("new");
                    setShowDeployModal(true);
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" /> New Agent
                </button>
              </div>
            </div>

            {/* Content */}
            <AgentDetail
              agent={selectedAgent}
              commands={commands}
              events={events}
              commandType={commandType}
              onCommandTypeChange={setCommandType}
              onDispatch={handleDispatch}
              dispatching={commandMutation.isPending}
              checkName={checkName}
              onCheckNameChange={setCheckName}
              shellCommand={shellCommand}
              onShellCommandChange={setShellCommand}
              filePath={filePath}
              onFilePathChange={setFilePath}
              uacProfile={uacProfile}
              onUacProfileChange={setUacProfile}
              investigations={investigations}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-text-muted">
            <div className="text-center">
              <Shield className="mx-auto h-14 w-14 mb-4 opacity-20" />
              <p className="text-sm font-medium text-text-secondary">Select an agent to view details</p>
              <p className="text-xs mt-1">or deploy a new agent to get started</p>
              <button
                onClick={() => {
                  setDeployMode("new");
                  setShowDeployModal(true);
                }}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Deploy Agent
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Deploy Configuration Modal (Screen 3) */}
      {showDeployModal && (
        <DeploymentModal
          investigations={investigations}
          selectedInvId={selectedInvId}
          onInvIdChange={setSelectedInvId}
          onRegister={(invId) => registerMutation.mutate(invId)}
          registering={registerMutation.isPending}
          onClose={() => setShowDeployModal(false)}
          selectedAgent={deployMode === "redeploy" ? selectedAgent : null}
        />
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title="Delete Agent"
        message={`Delete agent ${deleteConfirm.agent?.hostname || deleteConfirm.agent?.id?.slice(0, 8)}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteConfirm.agent) deleteMutation.mutate(deleteConfirm.agent.id);
          setDeleteConfirm({ isOpen: false, agent: null });
        }}
        onClose={() => setDeleteConfirm({ isOpen: false, agent: null })}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════
   Sidebar Agent Item
   ═══════════════════════════════════════════ */
function AgentSidebarItem({ agent, isSelected, onSelect }: { agent: Agent; isSelected: boolean; onSelect: () => void }) {
  const fullName = agent.hostname || agent.id.slice(0, 12);
  const shortName = fullName.length > 20 ? fullName.slice(0, 18) + "…" : fullName;

  return (
    <button
      onClick={onSelect}
      title={fullName}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
        isSelected
          ? "bg-brand-primary/10 text-brand-primary"
          : "text-text-secondary hover:bg-bg-hover"
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[agent.status] ?? "bg-zinc-500")} />
      <span className="truncate">{shortName}</span>
      <span className={cn("ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium border whitespace-nowrap", STATUS_COLORS[agent.status])}>
        {agent.status}
      </span>
    </button>
  );
}

/* ═══════════════════════════════════════════
   Agent Detail (Screen 1 + 2 combined via tabs)
   ═══════════════════════════════════════════ */
function AgentDetail({
  agent,
  commands,
  events,
  commandType,
  onCommandTypeChange,
  onDispatch,
  dispatching,
  checkName,
  onCheckNameChange,
  shellCommand,
  onShellCommandChange,
  filePath,
  onFilePathChange,
  uacProfile,
  onUacProfileChange,
  investigations,
}: {
  agent: Agent;
  commands: AgentCommand[];
  events: { id: number; type: string; data: Record<string, unknown>; created_at: string }[];
  commandType: string;
  onCommandTypeChange: (t: string) => void;
  onDispatch: (type?: string, payload?: Record<string, unknown>) => void;
  dispatching: boolean;
  checkName: string;
  onCheckNameChange: (v: string) => void;
  shellCommand: string;
  onShellCommandChange: (v: string) => void;
  filePath: string;
  onFilePathChange: (v: string) => void;
  uacProfile: string;
  onUacProfileChange: (v: string) => void;
  investigations: { id: number; name: string }[];
}) {
  const [view, setView] = useState<"dashboard" | "console">("dashboard");

  return (
    <div className="flex-1 overflow-y-auto">
      {/* View Tabs */}
      <div className="border-b border-border-subtle px-5">
        <div className="flex gap-0">
          <button
            className={cn(
              "px-4 py-2.5 text-xs font-medium border-b-2 transition-colors",
              view === "dashboard"
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            )}
            onClick={() => setView("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={cn(
              "px-4 py-2.5 text-xs font-medium border-b-2 transition-colors",
              view === "console"
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            )}
            onClick={() => setView("console")}
          >
            Console & Sync
          </button>
        </div>
      </div>

      {view === "dashboard" ? (
        <DashboardView
          agent={agent}
          commands={commands}
          events={events}
          commandType={commandType}
          onCommandTypeChange={onCommandTypeChange}
          onDispatch={onDispatch}
          dispatching={dispatching}
          checkName={checkName}
          onCheckNameChange={onCheckNameChange}
          shellCommand={shellCommand}
          onShellCommandChange={onShellCommandChange}
          filePath={filePath}
          onFilePathChange={onFilePathChange}
          uacProfile={uacProfile}
          onUacProfileChange={onUacProfileChange}
        />
      ) : (
        <ConsoleView
          agent={agent}
          commands={commands}
          events={events}
          onDispatch={onDispatch}
          dispatching={dispatching}
          investigations={investigations}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   Dashboard View (Screen 1)
   ═══════════════════════════════════════════ */
function DashboardView({
  agent,
  commands,
  events,
  commandType,
  onCommandTypeChange,
  onDispatch,
  dispatching,
  checkName,
  onCheckNameChange,
  shellCommand,
  onShellCommandChange,
  filePath,
  onFilePathChange,
  uacProfile,
  onUacProfileChange,
}: {
  agent: Agent;
  commands: AgentCommand[];
  events: { id: number; type: string; data: Record<string, unknown>; created_at: string }[];
  commandType: string;
  onCommandTypeChange: (t: string) => void;
  onDispatch: (type?: string, payload?: Record<string, unknown>) => void;
  dispatching: boolean;
  checkName: string;
  onCheckNameChange: (v: string) => void;
  shellCommand: string;
  onShellCommandChange: (v: string) => void;
  filePath: string;
  onFilePathChange: (v: string) => void;
  uacProfile: string;
  onUacProfileChange: (v: string) => void;
}) {
  const [tab, setTab] = useState<"commands" | "events">("commands");

  return (
    <div className="p-5 space-y-4">
      {/* Info Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <InfoCard icon={Server} label="Hostname" value={agent.hostname || "—"} />
        <InfoCard icon={Globe} label="IP Address" value={agent.ip_address || "—"} />
        <InfoCard icon={Cpu} label="OS" value={agent.os_info || "—"} />
        <HeartbeatCard lastHeartbeat={agent.last_heartbeat} status={agent.status} />
      </div>

      {/* Dispatch Command */}
      <div className="rounded-lg border border-border-subtle bg-bg-surface p-4">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3 flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5" /> Dispatch Command
        </h3>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:border-brand-primary/50 focus:outline-none"
              value={commandType}
              onChange={(e) => onCommandTypeChange(e.target.value)}
            >
              <option value="run_uac">Run UAC Collection</option>
              <option value="run_check">Run Check</option>
              <option value="exec_command">Execute Command</option>
              <option value="collect_file">Collect File</option>
              <option value="shutdown">Shutdown Agent</option>
            </select>

            {commandType === "run_check" && (
              <select
                className="flex-1 min-w-[200px] rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:border-brand-primary/50 focus:outline-none"
                value={checkName}
                onChange={(e) => onCheckNameChange(e.target.value)}
              >
                <option value="processes">Processes (ps auxf)</option>
                <option value="connections">Network Connections (ss -tlnp)</option>
                <option value="users">Users &amp; Logins</option>
                <option value="crontabs">Cron Jobs</option>
                <option value="services">Running Services</option>
                <option value="modules">Kernel Modules (lsmod)</option>
                <option value="mounts">Mounts &amp; Disk</option>
                <option value="env">Environment Variables</option>
                <option value="hosts">Hosts &amp; DNS</option>
                <option value="history">Bash History (last 100)</option>
              </select>
            )}
            {commandType === "exec_command" && (
              <input
                className="flex-1 min-w-[200px] rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-brand-primary/50 focus:outline-none font-mono"
                placeholder="Shell command, e.g. whoami"
                value={shellCommand}
                onChange={(e) => onShellCommandChange(e.target.value)}
              />
            )}
            {commandType === "collect_file" && (
              <input
                className="flex-1 min-w-[200px] rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-brand-primary/50 focus:outline-none font-mono"
                placeholder="File path, e.g. /var/log/auth.log"
                value={filePath}
                onChange={(e) => onFilePathChange(e.target.value)}
              />
            )}
            {commandType === "run_uac" && (
              <input
                className="flex-1 min-w-[200px] rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-brand-primary/50 focus:outline-none"
                placeholder="Profile (default: ir_triage)"
                value={uacProfile}
                onChange={(e) => onUacProfileChange(e.target.value)}
              />
            )}
            {commandType === "shutdown" && (
              <span className="flex-1 min-w-[200px] flex items-center text-xs text-text-muted italic px-3">
                No payload — agent will shut down
              </span>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => onDispatch()}
              disabled={dispatching}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              <Play className="h-3.5 w-3.5" /> {dispatching ? "Sending..." : "Send Command"}
            </button>
          </div>
        </div>
      </div>

      {/* Command / Events Tabs */}
      <div className="flex items-center gap-px border-b border-border-subtle">
        <button
          className={cn(
            "px-4 py-2 text-xs font-medium border-b-2 transition-colors",
            tab === "commands"
              ? "border-brand-primary text-brand-primary"
              : "border-transparent text-text-muted hover:text-text-secondary"
          )}
          onClick={() => setTab("commands")}
        >
          Commands ({commands.length})
        </button>
        <button
          className={cn(
            "px-4 py-2 text-xs font-medium border-b-2 transition-colors",
            tab === "events"
              ? "border-brand-primary text-brand-primary"
              : "border-transparent text-text-muted hover:text-text-secondary"
          )}
          onClick={() => setTab("events")}
        >
          Events ({events.length})
        </button>
      </div>

      {/* Tab Content */}
      {tab === "commands" ? (
        <div className="space-y-2">
          {commands.length === 0 ? (
            <p className="text-xs text-text-muted py-6 text-center">No commands yet</p>
          ) : (
            commands.map((cmd) => <CommandCard key={cmd.id} cmd={cmd} />)
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {events.length === 0 ? (
            <p className="text-xs text-text-muted py-6 text-center">No events yet</p>
          ) : (
            events.map((evt) => (
              <div key={evt.id} className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-surface p-2.5 text-xs">
                <span className="text-text-primary font-mono text-[11px]">{evt.type}</span>
                <span className="text-text-muted">{new Date(evt.created_at).toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   Console & Sheetstorm Sync View (Screen 2)
   ═══════════════════════════════════════════ */
function ConsoleView({
  agent,
  commands,
  events,
  onDispatch,
  dispatching,
  investigations,
}: {
  agent: Agent;
  commands: AgentCommand[];
  events: { id: number; type: string; data: Record<string, unknown>; created_at: string }[];
  onDispatch: (type?: string, payload?: Record<string, unknown>) => void;
  dispatching: boolean;
  investigations: { id: number; name: string }[];
}) {
  const toast = useToastHelpers();
  const queryClient = useQueryClient();
  const invName = investigations.find((i) => i.id === agent.investigation_id)?.name ?? "Unknown";

  const { data: sheetstormStatus } = useQuery({
    queryKey: ["sheetstorm-status"],
    queryFn: getSheetstormStatus,
    retry: false,
  });

  const syncMutation = useMutation({
    mutationFn: () => syncToSheetstorm(agent.investigation_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sheetstorm-status"] });
      toast.success("Findings synced to Sheetstorm");
    },
    onError: () => toast.error("Sync failed — is Sheetstorm configured?"),
  });

  const isConnected = sheetstormStatus?.configured === true;

  return (
    <div className="p-5 space-y-4">
      {/* Sheetstorm Connectivity Bar */}
      <div className="rounded-lg border border-border-subtle bg-bg-surface p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">
          Sheetstorm Connectivity
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border",
              isConnected
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
            )}>
              <span className={cn("h-1.5 w-1.5 rounded-full", isConnected ? "bg-emerald-400" : "bg-zinc-500")} />
              Sync Status: {isConnected ? "Connected" : "Disconnected"}
            </span>
            <span className="text-xs text-text-muted">
              · {invName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1.5 rounded-lg border border-brand-primary/40 px-3 py-1.5 text-xs text-brand-primary hover:bg-brand-primary/10 transition-colors"
            >
              <Link2 className="h-3 w-3" /> Link to Sheetstorm
            </button>
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || !agent.investigation_id}
              className="flex items-center gap-1.5 rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-medium text-bg-base hover:bg-brand-primary-hover disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={cn("h-3 w-3", syncMutation.isPending && "animate-spin")} />
              Sync Findings
            </button>
          </div>
        </div>
      </div>

      {/* Split: Metadata + Quick Checks | Terminal Output */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: Metadata & Quick Checks */}
        <div className="rounded-lg border border-border-subtle bg-bg-surface p-4 space-y-4">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Agent Metadata & Quick Checks
          </h3>

          {/* Metadata Table */}
          <div className="space-y-2 text-xs">
            <MetadataRow label="Agent ID" value={agent.id} mono />
            <MetadataRow label="Status">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium border", STATUS_COLORS[agent.status])}>
                {agent.status}
              </span>
            </MetadataRow>
            <MetadataRow label="IP" value={agent.ip_address || "—"} />
            <MetadataRow label="OS" value={agent.os_info || "—"} />
            <MetadataRow label="Heartbeat" value={
              agent.last_heartbeat
                ? `${formatRelativeTime(agent.last_heartbeat)} ago`
                : "Never"
            } />
          </div>

          {/* Quick Check Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            {QUICK_CHECKS.map((check) => {
              const Icon = check.icon;
              return (
                <button
                  key={check.id}
                  onClick={() => onDispatch("run_check", { check: check.id })}
                  disabled={dispatching}
                  className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-50"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-brand-primary" />
                  {check.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Terminal Output */}
        <TerminalOutput agent={agent} commands={commands} events={events} onDispatch={onDispatch} dispatching={dispatching} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Terminal Output (Screen 2 right panel)
   ═══════════════════════════════════════════ */
function TerminalOutput({
  agent,
  commands,
  events,
  onDispatch,
  dispatching,
}: {
  agent: Agent;
  commands: AgentCommand[];
  events: { id: number; type: string; data: Record<string, unknown>; created_at: string }[];
  onDispatch: (type?: string, payload?: Record<string, unknown>) => void;
  dispatching: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cmdInput, setCmdInput] = useState("");

  // Build terminal lines from commands & events
  const lines = useMemo(() => {
    const result: { text: string; color: string }[] = [];
    const prompt = `agent@${agent.id.slice(0, 8)}:~$`;

    // Mix commands and events in chronological order
    const allItems = [
      ...commands.map((c) => ({ ts: c.created_at ?? "", kind: "cmd" as const, item: c })),
      ...events.map((e) => ({ ts: e.created_at, kind: "evt" as const, item: e })),
    ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    for (const entry of allItems.slice(-30)) {
      if (entry.kind === "cmd") {
        const cmd = entry.item as AgentCommand;
        result.push({ text: `${prompt} ${cmd.type} ${formatPayloadBrief(cmd)}`, color: "text-emerald-400" });
        if (cmd.status === "completed" && cmd.result) {
          const output = typeof cmd.result === "object" && "output" in cmd.result
            ? String(cmd.result.output)
            : JSON.stringify(cmd.result, null, 2);
          for (const line of output.split("\n").slice(0, 20)) {
            result.push({ text: `  ${line}`, color: "text-zinc-400" });
          }
        } else if (cmd.status === "failed" && cmd.result) {
          const errMsg = typeof cmd.result === "object" && "error" in cmd.result
            ? String(cmd.result.error)
            : JSON.stringify(cmd.result);
          result.push({ text: `[ERROR] ${errMsg}`, color: "text-red-400" });
        } else if (cmd.status === "pending" || cmd.status === "running") {
          result.push({ text: `[INFO] Waiting for agent response...`, color: "text-blue-400" });
        }
      } else {
        const evt = entry.item as { type: string; data: Record<string, unknown> };
        const level = evt.type.includes("error") ? "ALERT" : "INFO";
        const color = level === "ALERT" ? "text-yellow-400" : "text-blue-400";
        result.push({ text: `[${level}] ${evt.type}`, color });
      }
    }

    if (result.length === 0) {
      result.push({ text: `${prompt} awaiting commands...`, color: "text-emerald-400" });
    }

    result.push({ text: `${prompt} _`, color: "text-emerald-400" });
    return result;
  }, [agent, commands, events]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  return (
    <div className="rounded-lg border border-border-subtle bg-[#0a0e14] flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800/80 bg-[#0d1117]">
        <Terminal className="h-3.5 w-3.5 text-text-muted" />
        <span className="text-[11px] font-medium text-text-secondary">Real-time Terminal Output</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-5 min-h-[280px] max-h-[400px]">
        {lines.map((line, i) => (
          <div key={i} className={cn("whitespace-pre-wrap break-all", line.color)}>{line.text}</div>
        ))}
      </div>
      {/* Command Input */}
      <div className="border-t border-zinc-800/80 px-4 py-2 flex items-center gap-2 bg-[#0d1117]">
        <span className="text-[11px] font-mono text-emerald-400 shrink-0">
          agent@{agent.id.slice(0, 8)}:~$
        </span>
        <input
          type="text"
          value={cmdInput}
          onChange={(e) => setCmdInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && cmdInput.trim()) {
              onDispatch("exec_command", { command: cmdInput.trim() });
              setCmdInput("");
            }
          }}
          placeholder="Type a command and press Enter..."
          disabled={dispatching}
          className="flex-1 bg-transparent text-[11px] font-mono text-zinc-300 placeholder:text-zinc-600 outline-none disabled:opacity-50"
        />
        {dispatching && <Spinner />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Deployment Configuration Modal (Screen 3)
   ═══════════════════════════════════════════ */
function DeploymentModal({
  investigations,
  selectedInvId,
  onInvIdChange,
  onRegister,
  registering,
  onClose,
  selectedAgent,
}: {
  investigations: { id: number; name: string }[];
  selectedInvId: number;
  onInvIdChange: (id: number) => void;
  onRegister: (invId: number) => void;
  registering: boolean;
  onClose: () => void;
  selectedAgent: Agent | null;
}) {
  const toast = useToastHelpers();
  const [profile, setProfile] = useState("ir_triage");
  const [arch, setArch] = useState<"amd64" | "arm64">("amd64");
  const [persist, setPersist] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bootstrapToken, setBootstrapToken] = useState("");

  // Fetch a short-lived bootstrap token whenever the selected agent changes
  useEffect(() => {
    if (!selectedAgent) return;
    setBootstrapToken("");
    fetch(`/api/v1/agents/${selectedAgent.id}/bootstrap-token`, {
      method: "POST",
      headers: getAuthHeader(),
    })
      .then((r) => r.json())
      .then((d) => setBootstrapToken(d.token ?? ""))
      .catch(() => {/* non-fatal: command will show without token */});
  }, [selectedAgent?.id]);

  const defaultBackend = typeof window !== "undefined" ? window.location.origin : "https://YOUR_SERVER";
  const [backendUrl, setBackendUrl] = useState(defaultBackend);
  const agentId = selectedAgent?.id ?? "<AGENT_ID>";

  const queryParams = new URLSearchParams();
  if (bootstrapToken) queryParams.set("token", bootstrapToken);
  if (backendUrl && backendUrl !== defaultBackend) queryParams.set("backend_url", backendUrl);
  const qs = queryParams.toString() ? `?${queryParams.toString()}` : "";

  const deployCmd = `curl -sSL "${defaultBackend}/api/v1/agents/${agentId}/bootstrap${qs}" | sudo \\\n  UAC_PROFILE=${profile} TARGET_ARCH=${arch} PERSIST=${persist} bash`;

  const handleCopy = async () => {
    const text = deployCmd.replace(/\\\n  /g, ' ');
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-HTTPS / remote IP access
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy — select the text manually");
    }
  };

  const handleDownloadScript = async () => {
    if (!selectedAgent) {
      toast.error("Register an agent first to download the script");
      return;
    }
    try {
      const response = await fetch(`/api/v1/agents/${selectedAgent.id}/bootstrap`, {
        headers: getAuthHeader(),
      });
      if (!response.ok) throw new Error("Failed");
      const script = await response.text();
      const blob = new Blob([script], { type: "text/x-shellscript" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `deploy-${selectedAgent.id.slice(0, 8)}.sh`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download script");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-border-subtle bg-bg-surface p-6 shadow-2xl shadow-black/40">
        <h3 className="text-lg font-heading font-semibold text-text-primary mb-5">
          Agent Deployment Configuration
        </h3>

        {/* 1. Select UAC Profile */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">
            1. Select UAC Profile
          </label>
          <select
            className="w-full rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-text-primary focus:border-brand-primary/50 focus:outline-none"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
          >
            <option value="ir_triage">ir_triage</option>
            <option value="full">full</option>
            <option value="offline">offline</option>
          </select>
        </div>

        {/* 2. Target Architecture */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">
            2. Target Architecture
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="radio"
                name="arch"
                checked={arch === "amd64"}
                onChange={() => setArch("amd64")}
                className="accent-emerald-500"
              />
              amd64
            </label>
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="radio"
                name="arch"
                checked={arch === "arm64"}
                onChange={() => setArch("arm64")}
                className="accent-emerald-500"
              />
              arm64
            </label>
          </div>
        </div>

        {/* 3. Persistence Settings */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">
            3. Persistence Settings
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={persist}
              onChange={(e) => setPersist(e.target.checked)}
              className="accent-emerald-500 rounded"
            />
            Enable Persistence (requires elevated privileges)
          </label>
        </div>

        {/* 4. Agent Backend URL */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">
            4. Agent Backend URL
          </label>
          <input
            type="text"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            placeholder="http://192.168.1.10:5001"
            className="w-full rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-text-primary font-mono focus:border-brand-primary/50 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-text-muted">
            URL the agent will use to reach this backend. Change if the agent is on a different network segment.
          </p>
        </div>

        {/* 5. Deployment Command (only shown after registration) */}
        {selectedAgent ? (
          <div className="mb-5">
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">
              5. Deployment Command
            </label>
            <div className="relative rounded-lg border border-border-subtle bg-[#0a0e14] p-3">
              <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-all pr-8">
                {deployCmd}
              </pre>
              <button
                onClick={handleCopy}
                className="absolute top-2 right-2 rounded-md p-1.5 text-text-muted hover:bg-bg-hover transition-colors"
                title="Copy to clipboard"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-5 rounded-lg border border-border-subtle bg-bg-elevated/50 p-3 text-center text-xs text-text-muted">
            Click <span className="font-semibold text-text-secondary">Register &amp; Deploy</span> below to create the agent — the deploy command will appear here.
          </div>
        )}

        {/* Investigation selector (needed for register) */}
        {!selectedAgent && (
          <div className="mb-5">
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">
              Investigation
            </label>
            <select
              className="w-full rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-text-primary focus:border-brand-primary/50 focus:outline-none"
              value={selectedInvId}
              onChange={(e) => onInvIdChange(Number(e.target.value))}
            >
              <option value={0} disabled>Select investigation...</option>
              {investigations.map((inv) => (
                <option key={inv.id} value={inv.id}>{inv.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          {selectedAgent ? (
            <button
              onClick={handleDownloadScript}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
            >
              <Download className="h-4 w-4" /> Download .sh Script
            </button>
          ) : (
            <button
              onClick={() => selectedInvId && onRegister(selectedInvId)}
              disabled={!selectedInvId || registering}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              {registering ? "Registering..." : "Register & Deploy"}
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg border border-border-subtle px-4 py-2 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Reusable Pieces
   ═══════════════════════════════════════════ */

function InfoCard({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-surface p-3">
      <div className="flex items-center gap-1.5 text-text-muted mb-1">
        <Icon className="h-3 w-3" />
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-sm font-medium text-text-primary truncate">{value}</div>
    </div>
  );
}

function HeartbeatCard({ lastHeartbeat, status }: { lastHeartbeat: string | null; status: string }) {
  const isAlive = status === "idle" || status === "collecting" || status === "uploading";
  const timeText = lastHeartbeat ? `Last seen: ${formatRelativeTime(lastHeartbeat)} ago` : "Never";

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 overflow-hidden">
      <div className="flex items-center gap-1.5 text-text-muted mb-1">
        <Heart className="h-3 w-3" />
        <span className="text-[10px] font-semibold uppercase tracking-wide">Heartbeat</span>
      </div>
      {/* Animated pulse line */}
      <div className="flex items-center gap-2">
        <svg
          viewBox="0 0 120 24"
          className="h-5 flex-1"
          preserveAspectRatio="none"
        >
          <path
            d={isAlive
              ? "M0,12 L20,12 L25,4 L30,20 L35,4 L40,20 L45,12 L60,12 L65,4 L70,20 L75,4 L80,20 L85,12 L120,12"
              : "M0,12 L120,12"
            }
            fill="none"
            stroke={isAlive ? "#10b981" : "#52525b"}
            strokeWidth="1.5"
            className={isAlive ? "animate-pulse" : ""}
          />
        </svg>
      </div>
      <div className={cn("text-[10px] mt-1", isAlive ? "text-emerald-400" : "text-text-muted")}>
        {timeText}
      </div>
    </div>
  );
}

function CommandCard({ cmd }: { cmd: AgentCommand }) {
  const [expanded, setExpanded] = useState(false);
  const result = cmd.result && typeof cmd.result === "object" ? cmd.result as Record<string, unknown> : null;
  const uploadedFile = result && "uploaded_file" in result ? String(result.uploaded_file) : null;
  const archiveFound = result && "archive" in result && !uploadedFile;

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-surface overflow-hidden">
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 p-3 text-left hover:bg-bg-hover/50 transition-colors cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-primary">{cmd.type}</span>
            {cmd.payload && Object.keys(cmd.payload).length > 0 && (
              <span className="text-[11px] text-text-muted font-mono truncate max-w-[300px]">
                {formatPayloadBrief(cmd)}
              </span>
            )}
          </div>
          <div className="text-[10px] text-text-muted mt-0.5">
            {cmd.created_at && new Date(cmd.created_at).toLocaleString()}
          </div>
        </div>
        {uploadedFile && (
          <button
            onClick={(e) => { e.stopPropagation(); downloadAgentFile(cmd.agent_id, uploadedFile); }}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-emerald-600/40 px-2 py-1 text-[10px] font-medium text-emerald-400 hover:bg-emerald-900/20 transition-colors"
          >
            <Download className="h-3 w-3" /> Download
          </button>
        )}
        {archiveFound && (
          <span className="shrink-0 flex items-center gap-1 rounded-lg border border-amber-600/40 px-2 py-1 text-[10px] font-medium text-amber-400 animate-pulse">
            <RefreshCw className="h-3 w-3 animate-spin" /> Uploading...
          </span>
        )}
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium border", CMD_STATUS_COLORS[cmd.status])}>
          {cmd.status}
        </span>
        <ChevronRight className={cn("h-3 w-3 text-text-muted transition-transform", expanded && "rotate-90")} />
      </div>
      {expanded && cmd.result && (
        <div className="border-t border-border-subtle">
          <pre className="max-h-60 overflow-auto p-3 text-[11px] font-mono text-zinc-400 bg-[#0a0e14]">
            {typeof cmd.result === "object" && "output" in cmd.result
              ? String(cmd.result.output)
              : JSON.stringify(cmd.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function MetadataRow({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border-subtle last:border-0">
      <span className="text-text-muted">{label}</span>
      {children ?? <span className={cn("text-text-primary", mono && "font-mono text-[11px]")}>{value}</span>}
    </div>
  );
}

/* ── Helpers ── */
function formatPayloadBrief(cmd: AgentCommand): string {
  if (!cmd.payload || Object.keys(cmd.payload).length === 0) return "";
  if (cmd.type === "run_check" && cmd.payload.check) return String(cmd.payload.check);
  if (cmd.type === "exec_command" && cmd.payload.command) return String(cmd.payload.command).slice(0, 60);
  if (cmd.type === "collect_file" && cmd.payload.path) return String(cmd.payload.path);
  if (cmd.type === "run_uac" && cmd.payload.profile) return String(cmd.payload.profile);
  return JSON.stringify(cmd.payload).slice(0, 60);
}

function formatRelativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  if (isNaN(diff)) return "unknown";
  if (diff < 5000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}
