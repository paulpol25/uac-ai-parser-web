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
  XCircle,
  BookOpen,
  FileSearch,
  Hash,
  Clock,
  Anchor,
  Container,
  Scan,
  Brain,
  FolderSearch,
  Ban,
  Flame,
  Eye,
  Key,
  Zap,
  CircleDot,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { Spinner } from "@/components/ui/Loader";
import { useToastHelpers } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInvestigationStore } from "@/stores/investigationStore";
import { useAgentStore, type Agent, type AgentCommand } from "@/stores/agentStore";
import { getAuthHeader, isViewer } from "@/stores/authStore";
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
  cancelCommand,
  runPlaybook,
  listPlaybooks,
  createPlaybook,
  updatePlaybook,
  deletePlaybook,
  type Playbook,
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

/* ── Command type metadata ── */
const COMMAND_TYPE_META: Record<string, { label: string; icon: typeof Shield; description: string; payloadFields: { key: string; label: string; placeholder: string; type: "text" | "select" | "number"; options?: { value: string; label: string }[]; required?: boolean; default?: string }[] }> = {
  run_uac: {
    label: "Run UAC Collection",
    icon: Shield,
    description: "Run Unix-like Artifacts Collector with a specific profile",
    payloadFields: [
      { key: "profile", label: "Profile", placeholder: "ir_triage", type: "text", default: "ir_triage" },
    ],
  },
  run_check: {
    label: "Run Check",
    icon: Eye,
    description: "Run a specific system check on the agent",
    payloadFields: [
      {
        key: "check", label: "Check", placeholder: "Select check...", type: "select", required: true,
        options: [
          { value: "processes", label: "Processes (ps auxf)" },
          { value: "connections", label: "Network Connections (ss -tlnp)" },
          { value: "users", label: "Users & Logins" },
          { value: "crontabs", label: "Cron Jobs" },
          { value: "services", label: "Running Services" },
          { value: "modules", label: "Kernel Modules (lsmod)" },
          { value: "mounts", label: "Mounts & Disk" },
          { value: "env", label: "Environment Variables" },
          { value: "hosts", label: "Hosts & DNS" },
          { value: "history", label: "Bash History (last 100)" },
          { value: "login_logs", label: "Login Logs" },
          { value: "open_files", label: "Open Files (lsof)" },
          { value: "dns_cache", label: "DNS Cache" },
          { value: "firewall", label: "Firewall Rules" },
          { value: "ssh_keys", label: "SSH Authorized Keys" },
        ],
      },
    ],
  },
  exec_command: {
    label: "Execute Command",
    icon: Terminal,
    description: "Run an arbitrary shell command on the agent",
    payloadFields: [
      { key: "command", label: "Shell Command", placeholder: "e.g. whoami", type: "text", required: true },
    ],
  },
  collect_file: {
    label: "Collect File",
    icon: FileSearch,
    description: "Download a specific file from the agent",
    payloadFields: [
      { key: "path", label: "File Path", placeholder: "/var/log/auth.log", type: "text", required: true },
    ],
  },
  collect_logs: {
    label: "Collect Logs",
    icon: FolderSearch,
    description: "Collect log files matching a glob pattern",
    payloadFields: [
      { key: "pattern", label: "Glob Pattern", placeholder: "/var/log/*.log", type: "text", required: true },
    ],
  },
  hash_files: {
    label: "Hash Files (SHA-256)",
    icon: Hash,
    description: "Compute SHA-256 hashes for files in a directory",
    payloadFields: [
      { key: "path", label: "Directory Path", placeholder: "/usr/bin", type: "text", required: true },
      { key: "max_files", label: "Max Files", placeholder: "1000", type: "number" },
    ],
  },
  persistence_check: {
    label: "Persistence Check",
    icon: Anchor,
    description: "Scan 12+ persistence locations (cron, systemd, init, rc.local, etc.)",
    payloadFields: [],
  },
  network_capture: {
    label: "Network Capture",
    icon: Network,
    description: "Capture network traffic for a specified duration",
    payloadFields: [
      { key: "duration", label: "Duration (seconds)", placeholder: "30", type: "number", default: "30" },
    ],
  },
  filesystem_timeline: {
    label: "Filesystem Timeline",
    icon: Clock,
    description: "Generate a filesystem modification timeline",
    payloadFields: [
      { key: "path", label: "Root Path", placeholder: "/", type: "text", default: "/" },
    ],
  },
  docker_inspect: {
    label: "Docker Inspect",
    icon: Container,
    description: "Inspect all Docker containers, images, and networks",
    payloadFields: [],
  },
  yara_scan: {
    label: "YARA Scan",
    icon: Scan,
    description: "Run YARA rules against the filesystem",
    payloadFields: [
      { key: "rules_path", label: "Rules Path", placeholder: "Leave empty for managed rules", type: "text" },
    ],
  },
  memory_dump: {
    label: "Memory Dump",
    icon: Brain,
    description: "Dump process memory (requires root)",
    payloadFields: [],
  },
  shutdown: {
    label: "Shutdown Agent",
    icon: Ban,
    description: "Gracefully shut down the agent process",
    payloadFields: [],
  },
};

/* ── Playbook icon mapping ── */
const PLAYBOOK_ICONS: Record<string, typeof Shield> = {
  full_triage: Shield,
  quick_check: Clock,
  persistence_hunt: Anchor,
  network_analysis: Network,
  malware_hunt: Scan,
};

/* ── Quick Checks (for Console section) ── */
const QUICK_CHECKS = [
  { id: "processes", label: "Processes", icon: Bug },
  { id: "modules", label: "Kernel Audit", icon: Cpu },
  { id: "connections", label: "Connections", icon: Network },
  { id: "mounts", label: "Filesystems", icon: HardDrive },
  { id: "env", label: "Env Vars", icon: MemoryStick },
  { id: "history", label: "Bash History", icon: Settings2 },
  { id: "login_logs", label: "Login Logs", icon: Eye },
  { id: "open_files", label: "Open Files", icon: FileSearch },
  { id: "dns_cache", label: "DNS Cache", icon: Globe },
  { id: "firewall", label: "Firewall", icon: Flame },
  { id: "ssh_keys", label: "SSH Keys", icon: Key },
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
  const [sidebarTab, setSidebarTab] = useState<"agents" | "playbooks">("agents");

  // Smart payload fields — keyed by field name
  const [payloadFields, setPayloadFields] = useState<Record<string, string>>({ check: "processes" });

  const updatePayloadField = (key: string, value: string) => {
    setPayloadFields((prev) => ({ ...prev, [key]: value }));
  };

  // Reset payload fields when command type changes
  useEffect(() => {
    const meta = COMMAND_TYPE_META[commandType];
    if (meta) {
      const defaults: Record<string, string> = {};
      for (const f of meta.payloadFields) {
        defaults[f.key] = f.default ?? (f.type === "select" && f.options?.length ? f.options[0].value : "");
      }
      setPayloadFields(defaults);
    }
  }, [commandType]);

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
    refetchInterval: (query) => {
      const cmds = (query.state.data as { commands?: AgentCommand[] })?.commands;
      const hasActive = cmds?.some(c => c.status === "pending" || c.status === "running");
      return hasActive ? 2000 : 10000;
    },
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

  const cancelMutation = useMutation({
    mutationFn: (commandId: string) => cancelCommand(commandId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-commands"] });
      toast.success("Command cancelled");
    },
    onError: () => toast.error("Failed to cancel command"),
  });

  const playbookMutation = useMutation({
    mutationFn: ({ agentId, playbook }: { agentId: string; playbook: string }) =>
      runPlaybook(agentId, playbook),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["agent-commands"] });
      toast.success(`Playbook dispatched — ${data.commands?.length ?? 0} commands queued`);
    },
    onError: () => toast.error("Failed to run playbook"),
  });

  const handleDispatch = (type?: string, payload?: Record<string, unknown>) => {
    if (!selectedAgent) return;
    const t = type ?? commandType;
    let p = payload;

    if (!p) {
      const meta = COMMAND_TYPE_META[t];
      if (meta && meta.payloadFields.length > 0) {
        p = {};
        for (const field of meta.payloadFields) {
          const val = payloadFields[field.key]?.trim();
          if (field.required && !val) {
            toast.error(`${field.label} is required`);
            return;
          }
          if (val) {
            p[field.key] = field.type === "number" ? (parseInt(val, 10) || val) : val;
          }
        }
        if (Object.keys(p).length === 0) p = undefined;
      } else {
        p = undefined;
      }
    }
    commandMutation.mutate({ agentId: selectedAgent.id, type: t, payload: p });
  };

  const handleCancel = (commandId: string) => {
    cancelMutation.mutate(commandId);
  };

  const handlePlaybook = (playbook: string) => {
    if (!selectedAgent) return;
    playbookMutation.mutate({ agentId: selectedAgent.id, playbook });
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
        {/* Sidebar Tabs */}
        <div className="flex border-b border-border-subtle">
          <button
            onClick={() => setSidebarTab("agents")}
            className={cn(
              "flex-1 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors",
              sidebarTab === "agents"
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            )}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Server className="h-3.5 w-3.5" /> Agents
              {agents.length > 0 && (
                <span className="text-[10px] bg-bg-elevated rounded-full px-1.5 py-0.5">{agents.length}</span>
              )}
            </span>
          </button>
          <button
            onClick={() => setSidebarTab("playbooks")}
            className={cn(
              "flex-1 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors",
              sidebarTab === "playbooks"
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            )}
          >
            <span className="flex items-center justify-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" /> Playbooks
            </span>
          </button>
        </div>

        {sidebarTab === "agents" ? (
          <>
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
                              className={cn("shrink-0 rounded-md p-1 text-text-muted opacity-0 group-hover:opacity-100 hover:bg-bg-hover hover:text-emerald-400 transition-all mr-1", isViewer() && "hidden")}
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
          </>
        ) : (
          /* ── Playbooks Sidebar ── */
          <PlaybooksSidebar
            selectedAgent={selectedAgent}
            onPlaybook={handlePlaybook}
            playbookPending={playbookMutation.isPending || isViewer()}
          />
        )}
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedAgent ? (
          <>
            {/* Top Bar */}
            <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3 gap-4 min-w-0">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-text-primary font-heading flex items-center gap-2 min-w-0">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[selectedAgent.status] ?? "bg-zinc-500")} />
                  <span className="truncate">{selectedAgent.hostname || selectedAgent.id.slice(0, 12)}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium border", STATUS_COLORS[selectedAgent.status])}>
                    {selectedAgent.status}
                  </span>
                </h2>
                <p className="text-xs text-text-muted font-mono mt-0.5 truncate">{selectedAgent.id}</p>
              </div>
              <div className="flex items-center gap-2">
                {!isViewer() && (<>
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
                </>)}
              </div>
            </div>

            {/* Unified Content */}
            <AgentDashboard
              agent={selectedAgent}
              commands={commands}
              events={events}
              commandType={commandType}
              onCommandTypeChange={setCommandType}
              payloadFields={payloadFields}
              onPayloadFieldChange={updatePayloadField}
              onDispatch={handleDispatch}
              dispatching={commandMutation.isPending || isViewer()}
              onCancel={handleCancel}
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

      {/* Deploy Configuration Modal */}
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
   Playbooks Sidebar
   ═══════════════════════════════════════════ */
function PlaybooksSidebar({
  selectedAgent,
  onPlaybook,
  playbookPending,
}: {
  selectedAgent: Agent | null;
  onPlaybook: (name: string) => void;
  playbookPending: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToastHelpers();
  const [manageOpen, setManageOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["playbooks"],
    queryFn: listPlaybooks,
    staleTime: 30_000,
  });

  const playbooks = data?.playbooks ? Object.values(data.playbooks) : [];

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Available Playbooks
            </span>
            <button
              onClick={() => setManageOpen(true)}
              className="text-[10px] text-brand-primary hover:underline"
            >
              Manage
            </button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : playbooks.length === 0 ? (
            <p className="text-xs text-text-muted py-4 text-center">No playbooks yet</p>
          ) : (
            <div className="space-y-1.5">
              {playbooks.map((pb) => {
                const Icon = PLAYBOOK_ICONS[pb.name] || BookOpen;
                return (
                  <button
                    key={pb.name}
                    onClick={() => selectedAgent ? onPlaybook(pb.name) : toast.error("Select an agent first")}
                    disabled={playbookPending}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-lg border border-border-subtle p-2.5 text-left transition-colors disabled:opacity-50",
                      selectedAgent ? "hover:bg-bg-hover cursor-pointer" : "opacity-60 cursor-not-allowed"
                    )}
                  >
                    <Icon className="h-4 w-4 mt-0.5 text-brand-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-text-primary truncate">
                        {pb.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </div>
                      <div className="text-[10px] text-text-muted mt-0.5 line-clamp-2">
                        {pb.description}
                      </div>
                      <div className="text-[10px] text-text-muted mt-1 flex items-center gap-2">
                        <span>{pb.commands_count} cmd{pb.commands_count !== 1 ? "s" : ""}</span>
                        {pb.is_builtin && <span className="text-brand-primary">built-in</span>}
                      </div>
                    </div>
                    {selectedAgent && (
                      <Play className="h-3 w-3 text-emerald-400 mt-1 shrink-0 opacity-0 group-hover:opacity-100" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Manage Playbooks Modal */}
      {manageOpen && (
        <PlaybookManager
          playbooks={playbooks}
          onClose={() => setManageOpen(false)}
          onRefresh={() => queryClient.invalidateQueries({ queryKey: ["playbooks"] })}
        />
      )}
    </>
  );
}


/* ═══════════════════════════════════════════
   Agent Dashboard (unified view)
   ═══════════════════════════════════════════ */
function AgentDashboard({
  agent,
  commands,
  events,
  commandType,
  onCommandTypeChange,
  payloadFields,
  onPayloadFieldChange,
  onDispatch,
  dispatching,
  onCancel,
  investigations,
}: {
  agent: Agent;
  commands: AgentCommand[];
  events: { id: number; type: string; data: Record<string, unknown>; created_at: string }[];
  commandType: string;
  onCommandTypeChange: (t: string) => void;
  payloadFields: Record<string, string>;
  onPayloadFieldChange: (key: string, value: string) => void;
  onDispatch: (type?: string, payload?: Record<string, unknown>) => void;
  dispatching: boolean;
  onCancel: (commandId: string) => void;
  investigations: { id: number; name: string }[];
}) {
  const toast = useToastHelpers();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<"overview" | "terminal">("overview");
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

  // Command stats
  const cmdStats = useMemo(() => {
    let pending = 0, running = 0, completed = 0, failed = 0;
    for (const c of commands) {
      if (c.status === "pending") pending++;
      else if (c.status === "running") running++;
      else if (c.status === "completed") completed++;
      else if (c.status === "failed") failed++;
    }
    return { pending, running, completed, failed, total: commands.length };
  }, [commands]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-5 space-y-4">
        {/* Agent Info Row */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <InfoCard icon={Server} label="Hostname" value={agent.hostname || "—"} />
          <InfoCard icon={Globe} label="IP Address" value={agent.ip_address || "—"} />
          <InfoCard icon={Cpu} label="OS" value={agent.os_info || "—"} />
          <HeartbeatCard lastHeartbeat={agent.last_heartbeat} status={agent.status} />
          <div className="rounded-lg border border-border-subtle bg-bg-surface p-3">
            <div className="flex items-center gap-1.5 text-text-muted mb-1">
              <Zap className="h-3 w-3" />
              <span className="text-[10px] font-semibold uppercase tracking-wide">Commands</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {cmdStats.running > 0 && <span className="text-blue-400 flex items-center gap-1"><CircleDot className="h-3 w-3" />{cmdStats.running}</span>}
              {cmdStats.pending > 0 && <span className="text-yellow-400 flex items-center gap-1"><Clock className="h-3 w-3" />{cmdStats.pending}</span>}
              <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{cmdStats.completed}</span>
              {cmdStats.failed > 0 && <span className="text-red-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{cmdStats.failed}</span>}
            </div>
          </div>
        </div>

        {/* Sheetstorm Sync Bar */}
        <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border",
              isConnected
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
            )}>
              <span className={cn("h-1.5 w-1.5 rounded-full", isConnected ? "bg-emerald-400" : "bg-zinc-500")} />
              {isConnected ? "Sheetstorm Connected" : "Sheetstorm Offline"}
            </span>
            <span className="text-xs text-text-muted">Investigation: {invName}</span>
          </div>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !agent.investigation_id}
            className="flex items-center gap-1.5 rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-medium text-bg-base hover:bg-brand-primary-hover disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("h-3 w-3", syncMutation.isPending && "animate-spin")} />
            Sync Findings
          </button>
        </div>

        {/* Section Tabs: Overview / Terminal */}
        <div className="flex items-center gap-px border-b border-border-subtle">
          <button
            className={cn(
              "px-4 py-2 text-xs font-medium border-b-2 transition-colors",
              activeSection === "overview"
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            )}
            onClick={() => setActiveSection("overview")}
          >
            Overview & Commands
          </button>
          <button
            className={cn(
              "px-4 py-2 text-xs font-medium border-b-2 transition-colors",
              activeSection === "terminal"
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            )}
            onClick={() => setActiveSection("terminal")}
          >
            Terminal & Quick Checks
          </button>
        </div>

        {activeSection === "overview" ? (
          <div className="space-y-4">
            {/* Dispatch Command */}
            <div className="rounded-lg border border-border-subtle bg-bg-surface p-4">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3 flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5" /> Dispatch Command
              </h3>
              <div className="space-y-3">
                {/* Command Type Selection */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {Object.entries(COMMAND_TYPE_META).map(([type, meta]) => {
                    const Icon = meta.icon;
                    return (
                      <button
                        key={type}
                        onClick={() => onCommandTypeChange(type)}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs transition-all",
                          commandType === type
                            ? "border-brand-primary bg-brand-primary/10 text-brand-primary"
                            : "border-border-subtle text-text-secondary hover:bg-bg-hover hover:border-border-subtle/80"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate font-medium">{meta.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Selected command description + payload fields */}
                {COMMAND_TYPE_META[commandType] && (
                  <div className="rounded-lg border border-border-subtle bg-bg-elevated/50 p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <Info className="h-3.5 w-3.5 text-brand-primary shrink-0 mt-0.5" />
                      <p className="text-xs text-text-muted">{COMMAND_TYPE_META[commandType].description}</p>
                    </div>

                    {COMMAND_TYPE_META[commandType].payloadFields.length > 0 ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {COMMAND_TYPE_META[commandType].payloadFields.map((field) => (
                          <div key={field.key}>
                            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">
                              {field.label} {field.required && <span className="text-red-400">*</span>}
                            </label>
                            {field.type === "select" ? (
                              <select
                                value={payloadFields[field.key] ?? ""}
                                onChange={(e) => onPayloadFieldChange(field.key, e.target.value)}
                                className="w-full rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:border-brand-primary/50 focus:outline-none"
                              >
                                {field.options?.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={field.type === "number" ? "number" : "text"}
                                value={payloadFields[field.key] ?? ""}
                                onChange={(e) => onPayloadFieldChange(field.key, e.target.value)}
                                placeholder={field.placeholder}
                                className="w-full rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-brand-primary/50 focus:outline-none font-mono"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-text-muted italic">No payload required — command runs with defaults.</p>
                    )}

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
                )}
              </div>
            </div>

            {/* Commands List */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-2">
                  Command Results ({commands.length})
                </h3>
              </div>
              <div className="space-y-2">
                {commands.length === 0 ? (
                  <div className="rounded-lg border border-border-subtle bg-bg-surface p-8 text-center">
                    <Terminal className="mx-auto h-8 w-8 text-text-muted/30 mb-2" />
                    <p className="text-xs text-text-muted">No commands dispatched yet</p>
                    <p className="text-[10px] text-text-muted mt-1">Send a command above or run a playbook from the sidebar</p>
                  </div>
                ) : (
                  commands.map((cmd) => (
                    <CommandCard key={cmd.id} cmd={cmd} onCancel={onCancel} />
                  ))
                )}
              </div>
            </div>

            {/* Events */}
            {events.length > 0 && <EventsCollapsible events={events} />}
          </div>
        ) : (
          /* Terminal & Quick Checks View */
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Left: Metadata & Quick Checks */}
            <div className="rounded-lg border border-border-subtle bg-bg-surface p-4 space-y-4">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                Agent Metadata
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
                <MetadataRow label="Version" value={agent.agent_version || "—"} />
              </div>

              {/* Quick Check Buttons */}
              <div>
                <h4 className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-2">Quick Checks</h4>
                <div className="grid grid-cols-2 gap-1.5">
                  {QUICK_CHECKS.map((check) => {
                    const Icon = check.icon;
                    return (
                      <button
                        key={check.id}
                        onClick={() => onDispatch("run_check", { check: check.id })}
                        disabled={dispatching}
                        className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-elevated px-2.5 py-2 text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-50"
                      >
                        <Icon className="h-3 w-3 shrink-0 text-brand-primary" />
                        {check.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: Terminal Output */}
            <TerminalOutput agent={agent} commands={commands} events={events} onDispatch={onDispatch} dispatching={dispatching} />
          </div>
        )}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════
   Terminal Output
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

    const allItems = [
      ...commands.map((c) => ({ ts: c.created_at ?? "", kind: "cmd" as const, item: c })),
      ...events.map((e) => ({ ts: e.created_at, kind: "evt" as const, item: e })),
    ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    for (const entry of allItems.slice(-30)) {
      if (entry.kind === "cmd") {
        const cmd = entry.item as AgentCommand;
        result.push({ text: `${prompt} ${cmd.type} ${formatPayloadBrief(cmd)}`, color: "text-emerald-400" });
        if (cmd.status === "completed" && cmd.result) {
          const raw = cmd.result as Record<string, unknown>;
          const output = typeof raw === "object"
            ? ("stdout" in raw ? String(raw.stdout) : "output" in raw ? String(raw.output) : JSON.stringify(raw, null, 2))
            : JSON.stringify(cmd.result, null, 2);
          for (const line of output.split("\n").slice(0, 20)) {
            result.push({ text: `  ${line}`, color: "text-zinc-400" });
          }
        } else if (cmd.status === "failed" && cmd.result) {
          const errMsg = typeof cmd.result === "object" && "error" in cmd.result
            ? String(cmd.result.error)
            : JSON.stringify(cmd.result);
          result.push({ text: `[ERROR] ${errMsg}`, color: "text-red-400" });
        } else if (cmd.status === "cancelled") {
          result.push({ text: `[CANCELLED] Command was cancelled`, color: "text-zinc-400" });
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
        <span className="text-[11px] font-medium text-text-secondary">Live Terminal</span>
        <div className="ml-auto flex gap-1">
          <span className="h-2 w-2 rounded-full bg-red-500/60" />
          <span className="h-2 w-2 rounded-full bg-yellow-500/60" />
          <span className="h-2 w-2 rounded-full bg-emerald-500/60" />
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-5 min-h-[320px] max-h-[500px]">
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
   Deployment Configuration Modal
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

  useEffect(() => {
    if (!selectedAgent) return;
    setBootstrapToken("");
    fetch(`/api/v1/agents/${selectedAgent.id}/bootstrap-token`, {
      method: "POST",
      headers: getAuthHeader(),
    })
      .then((r) => r.json())
      .then((d) => setBootstrapToken(d.token ?? ""))
      .catch(() => {});
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
      const bsParams = new URLSearchParams();
      bsParams.set("backend_url", backendUrl);
      const response = await fetch(`/api/v1/agents/${selectedAgent.id}/bootstrap?${bsParams.toString()}`, {
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

        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">1. Select UAC Profile</label>
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

        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">2. Target Architecture</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input type="radio" name="arch" checked={arch === "amd64"} onChange={() => setArch("amd64")} className="accent-emerald-500" />
              amd64
            </label>
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input type="radio" name="arch" checked={arch === "arm64"} onChange={() => setArch("arm64")} className="accent-emerald-500" />
              arm64
            </label>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">3. Persistence Settings</label>
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} className="accent-emerald-500 rounded" />
            Enable Persistence (requires elevated privileges)
          </label>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">4. Agent Backend URL</label>
          <input
            type="text"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            placeholder="https://your-server:3000"
            className="w-full rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-text-primary font-mono focus:border-brand-primary/50 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-text-muted">
            URL the agent will use to reach this server (include port, e.g. :3000). Change if deploying on a remote host.
          </p>
        </div>

        {selectedAgent ? (
          <div className="mb-5">
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">5. Deployment Command</label>
            <div className="relative rounded-lg border border-border-subtle bg-[#0a0e14] p-3">
              <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-all pr-8">{deployCmd}</pre>
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

        {!selectedAgent && (
          <div className="mb-5">
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Investigation</label>
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
   Playbook Manager Modal
   ═══════════════════════════════════════════ */
function PlaybookManager({
  playbooks,
  onClose,
  onRefresh,
}: {
  playbooks: Playbook[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const toast = useToastHelpers();
  const [editingPlaybook, setEditingPlaybook] = useState<Playbook | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const deleteMut = useMutation({
    mutationFn: deletePlaybook,
    onSuccess: () => {
      onRefresh();
      toast.success("Playbook deleted");
    },
    onError: () => toast.error("Failed to delete playbook"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[80vh] rounded-2xl border border-border-subtle bg-bg-primary shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border-subtle">
          <h2 className="text-lg font-bold text-text-primary">Manage Playbooks</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {showCreateForm ? (
            <PlaybookForm
              editing={editingPlaybook}
              onSaved={() => {
                onRefresh();
                setShowCreateForm(false);
                setEditingPlaybook(null);
              }}
              onCancel={() => { setShowCreateForm(false); setEditingPlaybook(null); }}
            />
          ) : (
            <>
              <button
                onClick={() => { setEditingPlaybook(null); setShowCreateForm(true); }}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> New Playbook
              </button>

              {playbooks.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-8">No playbooks yet.</p>
              ) : (
                playbooks.map((pb) => {
                  const Icon = PLAYBOOK_ICONS[pb.name] || BookOpen;
                  return (
                    <div key={pb.id} className="flex items-center gap-3 rounded-lg border border-border-subtle p-3">
                      <Icon className="h-5 w-5 text-brand-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text-primary">
                          {pb.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                          {pb.is_builtin && (
                            <span className="ml-2 text-[10px] bg-brand-primary/10 text-brand-primary px-1.5 py-0.5 rounded">built-in</span>
                          )}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5">{pb.description}</div>
                        <div className="text-[10px] text-text-muted mt-1">{pb.commands_count} command(s)</div>
                      </div>
                      {!pb.is_builtin && (
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={() => { setEditingPlaybook(pb); setShowCreateForm(true); }}
                            className="rounded-md p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
                            title="Edit"
                          >
                            <Settings2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => deleteMut.mutate(pb.id)}
                            className="rounded-md p-1.5 text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════
   Playbook Create / Edit Form (improved UX)
   ═══════════════════════════════════════════ */
function PlaybookForm({
  editing,
  onSaved,
  onCancel,
}: {
  editing: Playbook | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToastHelpers();

  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [commands, setCommands] = useState<{ type: string; fields: Record<string, string> }[]>(
    editing?.commands.map((c) => ({
      type: c.type,
      fields: c.payload ? Object.fromEntries(Object.entries(c.payload).map(([k, v]) => [k, String(v)])) : {},
    })) ?? [{ type: "", fields: {} }],
  );
  const [saving, setSaving] = useState(false);

  const addCommand = () => setCommands((prev) => [...prev, { type: "", fields: {} }]);
  const removeCommand = (idx: number) => setCommands((prev) => prev.filter((_, i) => i !== idx));

  const updateCommandType = (idx: number, type: string) => {
    setCommands((prev) => prev.map((c, i) => {
      if (i !== idx) return c;
      const meta = COMMAND_TYPE_META[type];
      const defaults: Record<string, string> = {};
      if (meta) {
        for (const f of meta.payloadFields) {
          defaults[f.key] = f.default ?? (f.type === "select" && f.options?.length ? f.options[0].value : "");
        }
      }
      return { type, fields: defaults };
    }));
  };

  const updateCommandField = (idx: number, key: string, value: string) => {
    setCommands((prev) => prev.map((c, i) =>
      i === idx ? { ...c, fields: { ...c.fields, [key]: value } } : c
    ));
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    const parsed = commands
      .filter((c) => c.type)
      .map((c) => {
        const payload: Record<string, unknown> = {};
        const meta = COMMAND_TYPE_META[c.type];
        if (meta) {
          for (const field of meta.payloadFields) {
            const val = c.fields[field.key]?.trim();
            if (val) {
              payload[field.key] = field.type === "number" ? (parseInt(val, 10) || val) : val;
            }
          }
        }
        return {
          type: c.type,
          ...(Object.keys(payload).length > 0 ? { payload } : {}),
        };
      });
    if (parsed.length === 0) { toast.error("At least one command is required"); return; }

    setSaving(true);
    try {
      if (editing) {
        await updatePlaybook(editing.id, { name: name.trim(), description: description.trim(), commands: parsed });
        toast.success("Playbook updated");
      } else {
        await createPlaybook({ name: name.trim(), description: description.trim(), commands: parsed });
        toast.success("Playbook created");
      }
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save playbook");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-text-primary">
        {editing ? "Edit Playbook" : "New Playbook"}
      </h3>

      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!!editing}
          className="w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary disabled:opacity-50"
          placeholder="e.g. my_custom_playbook"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary resize-none"
          placeholder="What does this playbook do?"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-text-secondary">Commands</label>
          <button
            onClick={addCommand}
            className="text-[11px] text-brand-primary hover:underline flex items-center gap-0.5"
          >
            <Plus className="h-3 w-3" /> Add Command
          </button>
        </div>
        <div className="space-y-3">
          {commands.map((cmd, idx) => {
            const meta = cmd.type ? COMMAND_TYPE_META[cmd.type] : null;
            return (
              <div key={idx} className="rounded-lg border border-border-subtle bg-bg-elevated/50 p-3 space-y-2">
                <div className="flex gap-2 items-center">
                  <span className="text-[10px] font-semibold text-text-muted w-5">{idx + 1}.</span>
                  <select
                    value={cmd.type}
                    onChange={(e) => updateCommandType(idx, e.target.value)}
                    className="flex-1 rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary"
                  >
                    <option value="">Select command type…</option>
                    {Object.entries(COMMAND_TYPE_META).map(([type, m]) => (
                      <option key={type} value={type}>{m.label}</option>
                    ))}
                  </select>
                  {commands.length > 1 && (
                    <button
                      onClick={() => removeCommand(idx)}
                      className="shrink-0 rounded-md p-2 text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {meta && (
                  <>
                    <p className="text-[10px] text-text-muted pl-7">{meta.description}</p>
                    {meta.payloadFields.length > 0 && (
                      <div className="pl-7 grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {meta.payloadFields.map((field) => (
                          <div key={field.key}>
                            <label className="block text-[10px] font-medium text-text-muted mb-0.5">
                              {field.label} {field.required && <span className="text-red-400">*</span>}
                            </label>
                            {field.type === "select" ? (
                              <select
                                value={cmd.fields[field.key] ?? ""}
                                onChange={(e) => updateCommandField(idx, field.key, e.target.value)}
                                className="w-full rounded-md border border-border-subtle bg-bg-input px-2.5 py-1.5 text-xs text-text-primary"
                              >
                                {field.options?.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={field.type === "number" ? "number" : "text"}
                                value={cmd.fields[field.key] ?? ""}
                                onChange={(e) => updateCommandField(idx, field.key, e.target.value)}
                                placeholder={field.placeholder}
                                className="w-full rounded-md border border-border-subtle bg-bg-input px-2.5 py-1.5 text-xs text-text-primary font-mono placeholder:text-text-muted"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <button
          onClick={onCancel}
          className="rounded-lg border border-border-subtle px-4 py-2 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
        >
          {saving ? <Spinner className="h-3 w-3" /> : <Check className="h-3.5 w-3.5" />}
          {editing ? "Update" : "Create"}
        </button>
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
  // Force re-render every 5s to keep relative time fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(timer);
  }, []);
  const timeText = lastHeartbeat ? `Last seen: ${formatRelativeTime(lastHeartbeat)} ago` : "Never";

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 overflow-hidden">
      <div className="flex items-center gap-1.5 text-text-muted mb-1">
        <Heart className="h-3 w-3" />
        <span className="text-[10px] font-semibold uppercase tracking-wide">Heartbeat</span>
      </div>
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 120 24" className="h-5 flex-1" preserveAspectRatio="none">
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

type AgentEvent = { id: number; type: string; created_at: string; [key: string]: unknown };

function EventsCollapsible({ events }: { events: AgentEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 hover:text-text-primary transition-colors"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        Events ({events.length})
      </button>
      {expanded && (
        <div className="space-y-1">
          {events.slice(0, 20).map((evt) => (
            <div key={evt.id} className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-surface p-2.5 text-xs">
              <span className="text-text-primary font-mono text-[11px]">{evt.type}</span>
              <span className="text-text-muted">{new Date(evt.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommandCard({ cmd, onCancel, defaultExpanded = false }: { cmd: AgentCommand; onCancel: (id: string) => void; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const result = cmd.result && typeof cmd.result === "object" ? cmd.result as Record<string, unknown> : null;
  const uploadedFile = result && "uploaded_file" in result ? String(result.uploaded_file) : null;
  const archiveFound = result && "archive" in result && !uploadedFile;
  const canCancel = cmd.status === "pending" || cmd.status === "running";

  const StatusIcon = cmd.status === "completed" ? CheckCircle2
    : cmd.status === "failed" ? AlertTriangle
    : cmd.status === "running" ? RefreshCw
    : cmd.status === "cancelled" ? Ban
    : CircleDot;

  const statusIconColor = cmd.status === "completed" ? "text-emerald-400"
    : cmd.status === "failed" ? "text-red-400"
    : cmd.status === "running" ? "text-blue-400 animate-spin"
    : cmd.status === "cancelled" ? "text-zinc-400"
    : "text-yellow-400";

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-surface overflow-hidden">
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 p-3 text-left hover:bg-bg-hover/50 transition-colors cursor-pointer"
      >
        <StatusIcon className={cn("h-4 w-4 shrink-0", statusIconColor)} />
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
            {cmd.completed_at && ` · completed ${formatRelativeTime(cmd.completed_at)} ago`}
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
        {canCancel && (
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(cmd.id); }}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-red-600/40 px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-900/20 transition-colors"
            title="Cancel command"
          >
            <XCircle className="h-3 w-3" /> Cancel
          </button>
        )}
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium border", CMD_STATUS_COLORS[cmd.status])}>
          {cmd.status}
        </span>
        <ChevronRight className={cn("h-3 w-3 text-text-muted transition-transform", expanded && "rotate-90")} />
      </div>
      {expanded && cmd.result && (
        <div className="border-t border-border-subtle">
          <StructuredResultViewer result={cmd.result} agentId={cmd.agent_id} />
        </div>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════
   YARA Result Parser + Viewer
   ═══════════════════════════════════════════ */
interface YaraMatch {
  rule: string;
  file: string;
  strings: { offset: string; varName: string; content: string }[];
}

function parseYaraOutput(raw: string): YaraMatch[] {
  const matches: YaraMatch[] = [];
  let current: YaraMatch | null = null;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^0x[0-9a-f]+:/i.test(t)) {
      if (!current) continue;
      const firstColon = t.indexOf(":");
      const offset = t.slice(0, firstColon);
      const rest = t.slice(firstColon + 1);
      const secondColon = rest.indexOf(":");
      const varName = rest.slice(0, secondColon);
      const content = rest.slice(secondColon + 2);
      current.strings.push({ offset, varName, content });
    } else {
      const spaceIdx = t.indexOf(" ");
      if (spaceIdx > 0) {
        current = { rule: t.slice(0, spaceIdx), file: t.slice(spaceIdx + 1), strings: [] };
        matches.push(current);
      }
    }
  }
  return matches;
}

function YaraResultViewer({ raw, targetPath }: { raw: string; targetPath: string }) {
  const parsed = parseYaraOutput(raw);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (parsed.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-zinc-500">
        <CheckCircle2 className="h-7 w-7 text-emerald-500/60" />
        <p className="text-[12px] font-medium text-emerald-400">No YARA matches found</p>
        <p className="text-[10px] text-zinc-600 font-mono">{targetPath}</p>
      </div>
    );
  }

  const byRule = parsed.reduce((acc, m) => {
    if (!acc[m.rule]) acc[m.rule] = [];
    acc[m.rule].push(m);
    return acc;
  }, {} as Record<string, YaraMatch[]>);

  const uniqueFiles = new Set(parsed.map(m => m.file)).size;
  const ruleNames = Object.keys(byRule);

  return (
    <div className="space-y-2">
      {/* Summary bar */}
      <div className="flex items-center gap-2 px-1 pb-2 border-b border-zinc-800 flex-wrap">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
          <span className="text-[11px] font-semibold text-orange-400">
            {parsed.length} match{parsed.length !== 1 ? "es" : ""}
          </span>
        </div>
        <span className="text-zinc-700 text-[10px]">·</span>
        <span className="text-[10px] text-zinc-400">{ruleNames.length} rule{ruleNames.length !== 1 ? "s" : ""}</span>
        <span className="text-zinc-700 text-[10px]">·</span>
        <span className="text-[10px] text-zinc-400">{uniqueFiles} file{uniqueFiles !== 1 ? "s" : ""}</span>
        <span className="ml-auto text-[9px] text-zinc-600 font-mono truncate max-w-[200px]">{targetPath}</span>
      </div>

      {/* Rules */}
      <div className="space-y-1.5">
        {ruleNames.map((rule) => {
          const ruleMatches = byRule[rule];
          const isOpen = expanded[rule] ?? true;
          return (
            <div key={rule} className="border border-zinc-800 rounded-md overflow-hidden">
              {/* Rule header (clickable to collapse) */}
              <button
                onClick={() => setExpanded(p => ({ ...p, [rule]: !isOpen }))}
                className="w-full flex items-center gap-2 px-3 py-1.5 bg-zinc-900/70 hover:bg-zinc-900 transition-colors text-left"
              >
                {isOpen
                  ? <ChevronDown className="h-3 w-3 text-zinc-500 flex-shrink-0" />
                  : <ChevronRight className="h-3 w-3 text-zinc-500 flex-shrink-0" />}
                <Scan className="h-3 w-3 text-orange-400/80 flex-shrink-0" />
                <span className="text-[11px] font-semibold text-orange-300 font-mono flex-1 text-left">
                  {rule}
                </span>
                <span className="text-[9px] text-zinc-500 border border-zinc-700 rounded px-1.5 py-px">
                  {ruleMatches.length} file{ruleMatches.length !== 1 ? "s" : ""}
                </span>
              </button>

              {/* File matches */}
              {isOpen && (
                <div className="divide-y divide-zinc-800/50">
                  {ruleMatches.map((m, i) => (
                    <div key={i} className="px-3 py-2 bg-[#0a0e14]">
                      <div className="flex items-start gap-1.5">
                        <FolderSearch className="h-3 w-3 text-zinc-500 mt-0.5 flex-shrink-0" />
                        <span className="text-[10px] font-mono text-zinc-300 break-all">{m.file}</span>
                      </div>
                      {m.strings.length > 0 && (
                        <div className="ml-5 mt-1.5 space-y-0.5">
                          {m.strings.map((s, j) => (
                            <div key={j} className="flex items-baseline gap-2 min-w-0">
                              <span className="text-[9px] font-mono text-zinc-600 flex-shrink-0 w-16">{s.offset}</span>
                              <span className="text-[9px] font-mono text-emerald-500/90 flex-shrink-0">{s.varName}</span>
                              <span className="text-[9px] font-mono text-zinc-400 break-all">{s.content}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Structured Result Viewer
   ═══════════════════════════════════════════ */
function StructuredResultViewer({ result, agentId }: { result: unknown; agentId: string }) {
  const [tab, setTab] = useState<"output" | "json" | "error">("output");
  const obj = typeof result === "object" && result !== null ? result as Record<string, unknown> : null;

  if (!obj) {
    return (
      <pre className="max-h-60 overflow-auto p-3 text-[11px] font-mono text-zinc-400 bg-[#0a0e14]">
        {String(result)}
      </pre>
    );
  }

  const output = "output" in obj ? String(obj.output) : "stdout" in obj ? String(obj.stdout) : null;
  const stderr = "stderr" in obj ? String(obj.stderr) : null;
  const exitCode = "exit_code" in obj ? obj.exit_code : null;
  const checkName = "check" in obj && typeof obj.check === "string" ? obj.check : null;
  const uploadedFile = "uploaded_file" in obj ? String(obj.uploaded_file) : null;
  const checks = "checks" in obj && typeof obj.checks === "object" ? obj.checks as Record<string, unknown> : null;
  const hashes = "hashes" in obj && Array.isArray(obj.hashes) ? obj.hashes as { file: string; sha256: string }[] : null;
  const hasError = stderr && stderr.trim().length > 0;

  const yaraRaw = "matches" in obj ? String(obj.matches) : null;
  const yaraTargetPath = "target_path" in obj ? String(obj.target_path) : "";
  const isYara = yaraRaw !== null;

  const isStructuredJson = !output && !checks && !hashes && !isYara;

  const tabs: { key: string; label: string; show: boolean }[] = [
    { key: "output", label: output ? "Output" : checks ? "Checks" : hashes ? "Hashes" : isYara ? "YARA Results" : "Result", show: true },
    { key: "error", label: `Stderr${exitCode !== null ? ` (exit ${exitCode})` : ""}`, show: !!hasError },
    { key: "json", label: "Raw JSON", show: true },
  ];

  return (
    <div className="bg-[#0a0e14]">
      <div className="flex items-center gap-px border-b border-zinc-800 px-3">
        {tabs.filter(t => t.show).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={cn(
              "px-3 py-1.5 text-[10px] font-medium border-b transition-colors",
              tab === t.key
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            )}
          >
            {t.label}
          </button>
        ))}
        {uploadedFile && (
          <button
            onClick={() => downloadAgentFile(agentId, uploadedFile)}
            className="ml-auto flex items-center gap-1 px-2 py-1 text-[10px] text-emerald-400 hover:text-emerald-300"
          >
            <Download className="h-3 w-3" /> {uploadedFile}
          </button>
        )}
      </div>
      <div className="max-h-80 overflow-auto p-3">
        {tab === "output" && checks && (
          <div className="space-y-2">
            {Object.entries(checks).map(([key, val]) => (
              <div key={key}>
                <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide mb-0.5">{key.replace(/_/g, " ")}</div>
                <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap">{String(val)}</pre>
              </div>
            ))}
          </div>
        )}
        {tab === "output" && hashes && (
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="text-left text-zinc-500 border-b border-zinc-800">
                <th className="pb-1 pr-4">File</th>
                <th className="pb-1">SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {hashes.map((h, i) => (
                <tr key={i} className="border-b border-zinc-800/50">
                  <td className="py-1 pr-4 text-zinc-300 truncate max-w-[300px]">{h.file}</td>
                  <td className="py-1 text-zinc-500 break-all">{h.sha256}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "output" && output && (
          <div>
            {checkName && (
              <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide mb-1">{checkName.replace(/_/g, " ")}</div>
            )}
            <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap">{output}</pre>
          </div>
        )}
        {tab === "output" && isYara && (
          <YaraResultViewer raw={yaraRaw!} targetPath={yaraTargetPath} />
        )}
        {tab === "output" && isStructuredJson && (
          <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap">{JSON.stringify(obj, null, 2)}</pre>
        )}
        {tab === "error" && (
          <pre className="text-[11px] font-mono text-red-400/80 whitespace-pre-wrap">{stderr}</pre>
        )}
        {tab === "json" && (
          <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap">{JSON.stringify(obj, null, 2)}</pre>
        )}
      </div>
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
  if (cmd.type === "collect_logs" && cmd.payload.pattern) return String(cmd.payload.pattern);
  if (cmd.type === "hash_files" && cmd.payload.path) return String(cmd.payload.path);
  if (cmd.type === "network_capture" && cmd.payload.duration) return `${cmd.payload.duration}s`;
  if (cmd.type === "filesystem_timeline" && cmd.payload.path) return String(cmd.payload.path);
  if (cmd.type === "yara_scan" && cmd.payload.rules_path) return String(cmd.payload.rules_path);
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
