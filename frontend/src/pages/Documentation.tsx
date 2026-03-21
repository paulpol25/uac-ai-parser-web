import { useState } from "react";
import {
  BookOpen,
  Shield,
  Terminal,
  Eye,
  FileSearch,
  FolderSearch,
  Hash,
  Anchor,
  Network,
  Clock,
  Container,
  Scan,
  Brain,
  Ban,
  Server,
  ChevronRight,
  Play,
  Settings,
  Users,
  ShieldAlert,
  Bug,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ── Sections ── */
type SectionId =
  | "overview"
  | "agents"
  | "commands"
  | "playbooks"
  | "yara"
  | "rbac"
  | "settings"
  | "troubleshooting";

const SECTIONS: { id: SectionId; label: string; icon: typeof BookOpen }[] = [
  { id: "overview", label: "Overview", icon: BookOpen },
  { id: "agents", label: "Agent Deployment", icon: Server },
  { id: "commands", label: "Command Types", icon: Terminal },
  { id: "playbooks", label: "Playbooks", icon: Play },
  { id: "yara", label: "YARA Rules", icon: ShieldAlert },
  { id: "rbac", label: "Roles & Permissions", icon: Users },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "troubleshooting", label: "Troubleshooting", icon: Bug },
];

export function Documentation() {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");

  return (
    <div className="flex h-full">
      {/* Sidebar Nav */}
      <div className="w-56 shrink-0 border-r border-border-subtle bg-bg-base">
        <div className="p-4 border-b border-border-subtle">
          <h2 className="text-sm font-heading font-bold text-text-primary flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-brand-primary" />
            Documentation
          </h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors",
                    activeSection === section.id
                      ? "bg-brand-primary/10 text-brand-primary font-medium"
                      : "text-text-secondary hover:bg-bg-hover"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {section.label}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8">
          {activeSection === "overview" && <OverviewSection />}
          {activeSection === "agents" && <AgentsSection />}
          {activeSection === "commands" && <CommandsSection />}
          {activeSection === "playbooks" && <PlaybooksSection />}
          {activeSection === "yara" && <YaraSection />}
          {activeSection === "rbac" && <RbacSection />}
          {activeSection === "settings" && <SettingsSection />}
          {activeSection === "troubleshooting" && <TroubleshootingSection />}
        </div>
      </div>
    </div>
  );
}

/* ─── Reusable doc components ─── */
function DocHeading({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-heading font-bold text-text-primary mb-6">{children}</h1>;
}

function DocSubheading({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-lg font-heading font-semibold text-text-primary mt-8 mb-3 flex items-center gap-2">
      <ChevronRight className="h-4 w-4 text-brand-primary" />
      {children}
    </h2>
  );
}

function DocParagraph({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-text-secondary leading-relaxed mb-4">{children}</p>;
}

function DocCode({ children }: { children: string }) {
  return (
    <pre className="rounded-lg border border-border-subtle bg-[#0a0e14] p-4 text-[12px] font-mono text-zinc-300 overflow-x-auto mb-4 whitespace-pre-wrap">
      {children}
    </pre>
  );
}

function DocNote({ type = "info", children }: { type?: "info" | "warning" | "tip"; children: React.ReactNode }) {
  const styles = {
    info: "border-blue-500/30 bg-blue-500/5 text-blue-300",
    warning: "border-amber-500/30 bg-amber-500/5 text-amber-300",
    tip: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
  };
  const labels = { info: "Note", warning: "Warning", tip: "Tip" };
  return (
    <div className={cn("rounded-lg border p-4 mb-4", styles[type])}>
      <div className="text-xs font-bold uppercase tracking-wide mb-1">{labels[type]}</div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function DocTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto mb-4 rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-bg-elevated/50 border-b border-border-subtle">
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border-subtle last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-xs text-text-primary font-mono">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


/* ═══════════════════════════════════════════
   Section Content
   ═══════════════════════════════════════════ */

function OverviewSection() {
  return (
    <div>
      <DocHeading>UAC AI Platform</DocHeading>
      <DocParagraph>
        UAC AI is a forensic incident-response platform that deploys lightweight agents to collect artifacts from endpoints,
        analyzes them with AI-powered tools, and presents findings in a unified investigation workspace.
      </DocParagraph>

      <DocSubheading>Key Features</DocSubheading>
      <ul className="list-disc list-inside space-y-2 text-sm text-text-secondary mb-4">
        <li><strong className="text-text-primary">Agent-based collection</strong> — Deploy Go-based agents to Linux endpoints for remote artifact collection</li>
        <li><strong className="text-text-primary">13 command types</strong> — From shell execution to full UAC triage, network capture, YARA scanning, and more</li>
        <li><strong className="text-text-primary">Playbooks</strong> — Automate multi-command workflows with built-in and custom playbooks</li>
        <li><strong className="text-text-primary">AI-powered analysis</strong> — RAG-based querying with multiple LLM providers (OpenAI, Anthropic, Ollama, etc.)</li>
        <li><strong className="text-text-primary">YARA rule management</strong> — Upload, manage, and deploy YARA rules to agents</li>
        <li><strong className="text-text-primary">Timeline analysis</strong> — Build forensic timelines from collected artifacts</li>
        <li><strong className="text-text-primary">Role-based access control</strong> — Admin, Operator, and Viewer roles with granular permissions</li>
        <li><strong className="text-text-primary">Sheetstorm integration</strong> — Sync investigation findings to external reporting</li>
      </ul>

      <DocSubheading>Architecture</DocSubheading>
      <DocParagraph>
        The platform consists of four main components:
      </DocParagraph>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {[
          { title: "Frontend", desc: "React + TypeScript SPA with Tailwind CSS" },
          { title: "Backend", desc: "Flask REST API with PostgreSQL, Redis, and LLM integrations" },
          { title: "Agent", desc: "Go binary deployed to target endpoints via bootstrap script" },
          { title: "MCP Server", desc: "Model Context Protocol server for IDE integration" },
        ].map((c) => (
          <div key={c.title} className="rounded-lg border border-border-subtle bg-bg-surface p-4">
            <div className="text-sm font-semibold text-text-primary mb-1">{c.title}</div>
            <div className="text-xs text-text-muted">{c.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentsSection() {
  return (
    <div>
      <DocHeading>Agent Deployment</DocHeading>
      <DocParagraph>
        Agents are lightweight Go binaries that run on target Linux endpoints. They connect back to the backend server,
        receive commands, execute them, and upload results.
      </DocParagraph>

      <DocSubheading>How to Deploy an Agent</DocSubheading>
      <ol className="list-decimal list-inside space-y-3 text-sm text-text-secondary mb-4">
        <li>Navigate to the <strong className="text-text-primary">Agents</strong> page</li>
        <li>Click the <strong className="text-text-primary">+</strong> button next to an investigation, or click <strong className="text-text-primary">Deploy Agent</strong></li>
        <li>Select the target investigation and configure deployment options:
          <ul className="list-disc list-inside ml-6 mt-1 space-y-1 text-xs">
            <li><strong>UAC Profile:</strong> <code className="bg-bg-elevated px-1 rounded text-brand-primary">ir_triage</code> (default), <code className="bg-bg-elevated px-1 rounded text-brand-primary">full</code>, or <code className="bg-bg-elevated px-1 rounded text-brand-primary">offline</code></li>
            <li><strong>Architecture:</strong> amd64 or arm64</li>
            <li><strong>Persistence:</strong> Enable if you want the agent to survive reboots (requires root)</li>
            <li><strong>Backend URL:</strong> The URL the agent will use to reach this server</li>
          </ul>
        </li>
        <li>Click <strong className="text-text-primary">Register &amp; Deploy</strong> — a <code className="bg-bg-elevated px-1 rounded text-brand-primary">curl</code> command will appear</li>
        <li>Copy the command and run it on the target endpoint with root privileges</li>
      </ol>

      <DocNote type="tip">
        If the agent is on a different network segment, update the <strong>Backend URL</strong> field to the server&apos;s address
        as seen from the agent (e.g., <code className="bg-bg-elevated px-1 rounded">http://192.168.1.10:5001</code>).
      </DocNote>

      <DocSubheading>Agent Lifecycle</DocSubheading>
      <DocTable
        headers={["Status", "Description"]}
        rows={[
          ["registered", "Agent record created, waiting for first connection"],
          ["idle", "Agent connected and waiting for commands"],
          ["collecting", "Agent is running a collection task"],
          ["uploading", "Agent is uploading collected artifacts"],
          ["offline", "Agent has not sent a heartbeat recently"],
          ["error", "Agent encountered an error"],
        ]}
      />

      <DocSubheading>Bootstrap Script</DocSubheading>
      <DocParagraph>
        The deployment uses a bootstrap script that downloads the agent binary, configures it, and optionally sets up
        persistence via a systemd service. The script is generated per-agent with a one-time token.
      </DocParagraph>
      <DocCode>{`# Example deployment command
curl -sSL "https://your-server/api/v1/agents/<AGENT_ID>/bootstrap?token=<TOKEN>" | \\
  sudo UAC_PROFILE=ir_triage TARGET_ARCH=amd64 PERSIST=false bash`}</DocCode>

      <DocSubheading>Removing an Agent</DocSubheading>
      <DocParagraph>
        Select the agent and click the <strong>Remove</strong> button. This deletes the agent record and all associated
        commands from the database. To stop the agent on the endpoint, send a <code className="bg-bg-elevated px-1 rounded text-brand-primary">shutdown</code> command first.
      </DocParagraph>
    </div>
  );
}

function CommandsSection() {
  const commandDocs: {
    type: string;
    label: string;
    icon: typeof Shield;
    desc: string;
    payload: string;
    example: string;
  }[] = [
    {
      type: "run_uac",
      label: "Run UAC Collection",
      icon: Shield,
      desc: "Runs the Unix-like Artifacts Collector (UAC) with a specified profile. This is the primary artifact collection method — it gathers system logs, configurations, running processes, and more into an archive.",
      payload: '{"profile": "ir_triage"}',
      example: "Profiles: ir_triage (recommended for most cases), full (comprehensive collection), offline (no network artifacts)",
    },
    {
      type: "run_check",
      label: "Run Check",
      icon: Eye,
      desc: "Runs a specific system check and returns the output. Checks are quick, targeted reads of system state — ideal for initial triage.",
      payload: '{"check": "processes"}',
      example: "Available checks: processes, connections, users, crontabs, services, modules, mounts, env, hosts, history, login_logs, open_files, dns_cache, firewall, ssh_keys",
    },
    {
      type: "exec_command",
      label: "Execute Command",
      icon: Terminal,
      desc: "Runs an arbitrary shell command on the agent and returns stdout/stderr. Use with caution — commands run with the agent's privileges.",
      payload: '{"command": "whoami"}',
      example: "Any valid shell command. Output is captured and returned as structured result.",
    },
    {
      type: "collect_file",
      label: "Collect File",
      icon: FileSearch,
      desc: "Downloads a specific file from the agent. The file is uploaded to the backend and available for download from the command results.",
      payload: '{"path": "/var/log/auth.log"}',
      example: "Provide the absolute path to any file the agent can read.",
    },
    {
      type: "collect_logs",
      label: "Collect Logs",
      icon: FolderSearch,
      desc: "Collects log files matching a glob pattern. Multiple files are packaged into an archive.",
      payload: '{"pattern": "/var/log/*.log"}',
      example: "Standard glob patterns: /var/log/syslog*, /var/log/auth.log, /tmp/*.log",
    },
    {
      type: "hash_files",
      label: "Hash Files (SHA-256)",
      icon: Hash,
      desc: "Computes SHA-256 hashes for all files in a directory. Useful for integrity verification and IOC matching.",
      payload: '{"path": "/usr/bin", "max_files": 1000}',
      example: "Default max_files is 1000. Results are returned as a table of file paths and SHA-256 hashes.",
    },
    {
      type: "persistence_check",
      label: "Persistence Check",
      icon: Anchor,
      desc: "Scans 12+ common persistence locations including cron jobs, systemd units, init scripts, rc.local, .bashrc hooks, LD_PRELOAD, authorized_keys, and more.",
      payload: "{}",
      example: "No payload needed. Returns structured results organized by persistence mechanism.",
    },
    {
      type: "network_capture",
      label: "Network Capture",
      icon: Network,
      desc: "Captures network traffic using tcpdump for a specified duration. The PCAP file is uploaded for analysis.",
      payload: '{"duration": 30}',
      example: "Duration is in seconds. Default is 30. Requires tcpdump to be installed on the target.",
    },
    {
      type: "filesystem_timeline",
      label: "Filesystem Timeline",
      icon: Clock,
      desc: "Generates a timeline of filesystem modifications (created, modified, accessed times) starting from the specified path.",
      payload: '{"path": "/"}',
      example: 'Default path is "/". Use a more specific path for faster results.',
    },
    {
      type: "docker_inspect",
      label: "Docker Inspect",
      icon: Container,
      desc: "Inspects all Docker containers, images, and networks on the host. Useful for detecting container-based attacks or unauthorized deployments.",
      payload: "{}",
      example: "No payload needed. Requires Docker to be installed and the agent to have access to the Docker socket.",
    },
    {
      type: "yara_scan",
      label: "YARA Scan",
      icon: Scan,
      desc: "Runs YARA rules against the filesystem. Can use rules managed through the YARA Rules page or a custom rules path on the target.",
      payload: '{"rules_path": ""}',
      example: "Leave rules_path empty to use managed rules from the platform. Or specify a path on the target system.",
    },
    {
      type: "memory_dump",
      label: "Memory Dump",
      icon: Brain,
      desc: "Dumps process memory from the target system. Requires root privileges. The dump is uploaded as an archive.",
      payload: "{}",
      example: "No payload needed. Requires root/sudo access on the target.",
    },
    {
      type: "shutdown",
      label: "Shutdown Agent",
      icon: Ban,
      desc: "Gracefully shuts down the agent process. The agent will stop polling for commands and exit cleanly.",
      payload: "{}",
      example: "No payload needed. If persistence is enabled, the agent may restart via systemd.",
    },
  ];

  return (
    <div>
      <DocHeading>Command Types</DocHeading>
      <DocParagraph>
        UAC AI supports 13 command types that can be dispatched to agents. Commands are sent from the Agents page and
        results are displayed in the command results section.
      </DocParagraph>

      <DocNote type="info">
        Commands run with the privileges of the agent process. For most operations, the agent should be running as root.
      </DocNote>

      <div className="space-y-6">
        {commandDocs.map((cmd) => {
          const Icon = cmd.icon;
          return (
            <div key={cmd.type} className="rounded-lg border border-border-subtle bg-bg-surface p-5">
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4 text-brand-primary" />
                <h3 className="text-sm font-semibold text-text-primary">{cmd.label}</h3>
                <code className="text-[11px] bg-bg-elevated px-2 py-0.5 rounded text-text-muted font-mono ml-auto">{cmd.type}</code>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed mb-3">{cmd.desc}</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">Payload</div>
                  <pre className="rounded-md bg-[#0a0e14] p-2.5 text-[11px] font-mono text-zinc-300">{cmd.payload}</pre>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">Notes</div>
                  <p className="text-[11px] text-text-muted leading-relaxed">{cmd.example}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlaybooksSection() {
  return (
    <div>
      <DocHeading>Playbooks</DocHeading>
      <DocParagraph>
        Playbooks are predefined sequences of commands that run automatically on an agent. They let you automate
        common forensic workflows without manually dispatching each command.
      </DocParagraph>

      <DocSubheading>Built-in Playbooks</DocSubheading>
      <div className="space-y-3 mb-6">
        {[
          {
            name: "Full Triage",
            desc: "Comprehensive endpoint investigation — 8 commands covering UAC collection, persistence, processes, connections, crontabs, services, history, and filesystem timeline.",
            commands: ["run_uac", "persistence_check", "run_check (processes)", "run_check (connections)", "run_check (crontabs)", "run_check (services)", "run_check (history)", "filesystem_timeline"],
          },
          {
            name: "Quick Check",
            desc: "Fast initial assessment — 3 commands for a rapid overview of the endpoint state.",
            commands: ["run_check (processes)", "run_check (connections)", "run_check (users)"],
          },
          {
            name: "Persistence Hunt",
            desc: "Focused on finding persistence mechanisms — 4 commands targeting startup locations.",
            commands: ["persistence_check", "run_check (crontabs)", "run_check (services)", "run_check (modules)"],
          },
          {
            name: "Network Analysis",
            desc: "Network-focused collection — 4 commands for network state and traffic capture.",
            commands: ["run_check (connections)", "run_check (hosts)", "run_check (firewall)", "network_capture"],
          },
          {
            name: "Malware Hunt",
            desc: "Malware detection workflow — 5 commands combining YARA scanning with file hashing and process analysis.",
            commands: ["yara_scan", "hash_files", "run_check (processes)", "persistence_check", "run_check (modules)"],
          },
        ].map((pb) => (
          <div key={pb.name} className="rounded-lg border border-border-subtle bg-bg-surface p-4">
            <div className="text-sm font-semibold text-text-primary mb-1">{pb.name}</div>
            <p className="text-xs text-text-secondary mb-2">{pb.desc}</p>
            <div className="flex flex-wrap gap-1.5">
              {pb.commands.map((cmd, i) => (
                <span key={i} className="inline-block rounded-md bg-bg-elevated px-2 py-0.5 text-[10px] font-mono text-text-muted border border-border-subtle">
                  {cmd}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <DocSubheading>Creating Custom Playbooks</DocSubheading>
      <ol className="list-decimal list-inside space-y-2 text-sm text-text-secondary mb-4">
        <li>In the <strong className="text-text-primary">Agents</strong> page, switch to the <strong className="text-text-primary">Playbooks</strong> tab in the sidebar</li>
        <li>Click <strong className="text-text-primary">Manage</strong> to open the playbook manager</li>
        <li>Click <strong className="text-text-primary">New Playbook</strong></li>
        <li>Enter a name (snake_case recommended) and description</li>
        <li>Add commands:
          <ul className="list-disc list-inside ml-6 mt-1 space-y-1 text-xs">
            <li>Select a command type from the dropdown — each type shows a description and its payload fields</li>
            <li>Fill in the payload fields (e.g., select which check to run, enter a file path, etc.)</li>
            <li>Click <strong className="text-text-primary">+ Add Command</strong> to add more commands to the sequence</li>
          </ul>
        </li>
        <li>Click <strong className="text-text-primary">Create</strong> to save</li>
      </ol>

      <DocNote type="tip">
        Custom playbooks appear alongside built-in playbooks in the sidebar. You can edit or delete them at any time — built-in
        playbooks cannot be modified or deleted.
      </DocNote>

      <DocSubheading>Running a Playbook</DocSubheading>
      <DocParagraph>
        Select an agent from the sidebar, switch to the Playbooks tab, and click on a playbook card. All commands in the
        playbook will be dispatched sequentially to the agent. You can monitor progress in the command results section.
      </DocParagraph>
    </div>
  );
}

function YaraSection() {
  return (
    <div>
      <DocHeading>YARA Rules</DocHeading>
      <DocParagraph>
        YARA is a pattern-matching tool used to identify and classify malware. UAC AI allows you to upload, manage, and
        deploy YARA rule files to your agents for scanning.
      </DocParagraph>

      <DocSubheading>What are YARA Rules?</DocSubheading>
      <DocParagraph>
        YARA rules are text-based patterns that describe malware families or suspicious characteristics. Each rule
        contains conditions that are matched against files on the target system. When a file matches a rule, the agent
        reports the match.
      </DocParagraph>
      <DocCode>{`rule suspicious_binary {
    meta:
        description = "Detects suspicious binary patterns"
        author = "SOC Team"
        severity = "high"
    strings:
        $str1 = "/bin/sh" ascii
        $str2 = "socket" ascii
        $hex = { 48 89 E5 48 83 EC 20 }
    condition:
        uint32(0) == 0x464C457F and
        all of them
}`}</DocCode>

      <DocSubheading>Uploading YARA Rules</DocSubheading>
      <ol className="list-decimal list-inside space-y-2 text-sm text-text-secondary mb-4">
        <li>Navigate to the <strong className="text-text-primary">YARA Rules</strong> page</li>
        <li>Click <strong className="text-text-primary">Upload Rules</strong> or drag files into the upload area</li>
        <li>Supported formats: <code className="bg-bg-elevated px-1 rounded text-brand-primary">.yar</code>, <code className="bg-bg-elevated px-1 rounded text-brand-primary">.yara</code>, <code className="bg-bg-elevated px-1 rounded text-brand-primary">.txt</code></li>
        <li>Rules are validated on upload — invalid rules are rejected with an error message</li>
      </ol>

      <DocNote type="info">
        Uploaded YARA rules are stored on the backend and are automatically available to agents when you run a
        <code className="bg-bg-elevated px-1 rounded text-brand-primary mx-1">yara_scan</code> command without specifying a custom rules_path.
      </DocNote>

      <DocSubheading>Running YARA Scans</DocSubheading>
      <DocParagraph>
        From the Agents page, select an agent and dispatch a <code className="bg-bg-elevated px-1 rounded text-brand-primary">yara_scan</code> command.
        Leave the &quot;Rules Path&quot; field empty to use your managed rules, or specify a path on the agent for custom rules.
        Results show which files matched which rules.
      </DocParagraph>
    </div>
  );
}

function RbacSection() {
  return (
    <div>
      <DocHeading>Roles &amp; Permissions</DocHeading>
      <DocParagraph>
        UAC AI uses role-based access control (RBAC) with three roles. Each role has a set of permissions that control
        what the user can see and do in the platform.
      </DocParagraph>

      <DocSubheading>Roles</DocSubheading>
      <DocTable
        headers={["Role", "Description", "Typical Use"]}
        rows={[
          ["Admin", "Full access to all features including user management and settings", "SOC Manager, Platform Administrator"],
          ["Operator", "Can dispatch commands, manage investigations, run queries, and export data", "SOC Analyst, Incident Responder"],
          ["Viewer", "Read-only access to view investigations and their data", "Stakeholder, Auditor"],
        ]}
      />

      <DocSubheading>Permission Matrix</DocSubheading>
      <DocTable
        headers={["Permission", "Admin", "Operator", "Viewer"]}
        rows={[
          ["View investigations", "Yes", "Yes", "Yes"],
          ["Manage investigations", "Yes", "Yes", "No"],
          ["Upload evidence", "Yes", "Yes", "No"],
          ["Dispatch commands", "Yes", "Yes", "No"],
          ["Query data (AI)", "Yes", "Yes", "No"],
          ["Export data", "Yes", "Yes", "No"],
          ["Manage YARA rules", "Yes", "Yes", "No"],
          ["View settings", "Yes", "Yes", "No"],
          ["Manage settings", "Yes", "No", "No"],
          ["Manage users", "Yes", "No", "No"],
          ["View audit log", "Yes", "No", "No"],
        ]}
      />

      <DocSubheading>First User</DocSubheading>
      <DocParagraph>
        The first user to register on the platform is automatically promoted to the <strong>Admin</strong> role. Subsequent
        users are assigned the <strong>Viewer</strong> role by default and must be promoted by an admin.
      </DocParagraph>

      <DocNote type="info">
        You can also seed an admin account using environment variables{" "}
        <code className="bg-bg-elevated px-1 rounded text-brand-primary">ADMIN_EMAIL</code>,{" "}
        <code className="bg-bg-elevated px-1 rounded text-brand-primary">ADMIN_PASSWORD</code>, and{" "}
        <code className="bg-bg-elevated px-1 rounded text-brand-primary">ADMIN_USERNAME</code> in the backend configuration.
      </DocNote>
    </div>
  );
}

function SettingsSection() {
  return (
    <div>
      <DocHeading>Settings &amp; Configuration</DocHeading>
      <DocParagraph>
        Platform settings are managed through the Settings page (Admins only) and environment variables.
      </DocParagraph>

      <DocSubheading>LLM Provider Configuration</DocSubheading>
      <DocParagraph>
        UAC AI supports multiple LLM providers for AI-powered analysis. Configure your provider in the Settings page:
      </DocParagraph>
      <DocTable
        headers={["Provider", "Required Config", "Notes"]}
        rows={[
          ["OpenAI", "API Key, Model name", "Recommended: gpt-4o or gpt-4-turbo"],
          ["Anthropic", "API Key, Model name", "Recommended: claude-3-5-sonnet"],
          ["Ollama", "Base URL, Model name", "Local deployment, no API key needed"],
          ["Azure OpenAI", "API Key, Endpoint, Deployment", "Enterprise Azure deployment"],
          ["Google (Gemini)", "API Key, Model name", "Gemini Pro or Gemini Ultra"],
        ]}
      />

      <DocSubheading>Environment Variables</DocSubheading>
      <DocTable
        headers={["Variable", "Description", "Default"]}
        rows={[
          ["SECRET_KEY", "Flask secret key for session encryption", "auto-generated"],
          ["DATABASE_URL", "PostgreSQL connection string", "sqlite:///data/uac.db"],
          ["REDIS_URL", "Redis connection string for caching", "redis://localhost:6379"],
          ["ADMIN_EMAIL", "Seed admin email at startup", "(none)"],
          ["ADMIN_PASSWORD", "Seed admin password at startup", "(none)"],
          ["ADMIN_USERNAME", "Seed admin username at startup", "admin"],
          ["LLM_PROVIDER", "Default LLM provider", "ollama"],
          ["EMBEDDING_MODEL", "Embedding model name", "all-MiniLM-L6-v2"],
          ["MAX_UPLOAD_SIZE_MB", "Maximum upload file size", "500"],
        ]}
      />

      <DocSubheading>Sheetstorm Integration</DocSubheading>
      <DocParagraph>
        Sheetstorm is an external reporting tool. When configured, you can sync investigation findings directly from the
        Agents page. Configure the Sheetstorm URL and API key in the Settings page.
      </DocParagraph>
    </div>
  );
}

function TroubleshootingSection() {
  return (
    <div>
      <DocHeading>Troubleshooting</DocHeading>

      <DocSubheading>Agent Won&apos;t Connect</DocSubheading>
      <ul className="list-disc list-inside space-y-1 text-sm text-text-secondary mb-4">
        <li>Verify the backend URL is reachable from the agent&apos;s network</li>
        <li>Check that port 5001 (or your configured port) is open in firewalls</li>
        <li>Ensure the bootstrap token hasn&apos;t expired — re-register the agent if needed</li>
        <li>Check agent logs: <code className="bg-bg-elevated px-1 rounded text-brand-primary">journalctl -u uac-agent</code> (if persistence is enabled)</li>
      </ul>

      <DocSubheading>Commands Stay in &quot;Pending&quot;</DocSubheading>
      <ul className="list-disc list-inside space-y-1 text-sm text-text-secondary mb-4">
        <li>The agent polls for commands at regular intervals (default: 5 seconds)</li>
        <li>If the agent is offline, commands will queue until it reconnects</li>
        <li>Check the agent&apos;s status indicator — &quot;idle&quot; means connected and waiting</li>
        <li>You can cancel pending commands with the Cancel button</li>
      </ul>

      <DocSubheading>File Upload Failures</DocSubheading>
      <ul className="list-disc list-inside space-y-1 text-sm text-text-secondary mb-4">
        <li>Check available disk space on the backend server</li>
        <li>Verify the <code className="bg-bg-elevated px-1 rounded text-brand-primary">MAX_UPLOAD_SIZE_MB</code> setting</li>
        <li>Large files (UAC archives, memory dumps) may take time to upload over slow connections</li>
      </ul>

      <DocSubheading>AI Query Not Working</DocSubheading>
      <ul className="list-disc list-inside space-y-1 text-sm text-text-secondary mb-4">
        <li>Ensure an LLM provider is configured in Settings</li>
        <li>Verify API keys are valid and have sufficient credits/quota</li>
        <li>For Ollama: ensure the Ollama server is running and the model is downloaded</li>
        <li>Check backend logs for detailed error messages</li>
      </ul>

      <DocSubheading>Database Issues</DocSubheading>
      <DocParagraph>
        For development, UAC AI uses SQLite by default. For production, use PostgreSQL by setting the <code className="bg-bg-elevated px-1 rounded text-brand-primary">DATABASE_URL</code> environment variable.
        If you encounter database migration issues, the backend will log warnings at startup.
      </DocParagraph>

      <DocNote type="warning">
        Never delete the database without backing up first. Use <code className="bg-bg-elevated px-1 rounded text-brand-primary">pg_dump</code> for PostgreSQL or copy
        the <code className="bg-bg-elevated px-1 rounded text-brand-primary">data/uac.db</code> file for SQLite.
      </DocNote>
    </div>
  );
}
