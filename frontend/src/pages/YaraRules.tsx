import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Trash2,
  ShieldAlert,
  Github,
  ToggleLeft,
  ToggleRight,
  Eye,
  Download,
  Search,
  X,
  HelpCircle,
  Power,
  PowerOff,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { Spinner } from "@/components/ui/Loader";
import { useToastHelpers } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { isViewer } from "@/stores/authStore";
import {
  listYaraRules,
  uploadYaraRule,
  deleteYaraRule,
  toggleYaraRule,
  batchToggleYaraRules,
  syncYaraRulesFromGithub,
  getYaraRuleContent,
  type YaraRule,
} from "@/services/api";

/* ── Source badge colors ── */
const SOURCE_COLORS: Record<string, string> = {
  upload: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  elastic_github: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

/* ── Format bytes ── */
function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Rule viewer modal ── */
function RuleViewerModal({ rule, onClose }: { rule: YaraRule; onClose: () => void }) {
  const { data: content, isLoading } = useQuery({
    queryKey: ["yara-rule-content", rule.id],
    queryFn: () => getYaraRuleContent(rule.id),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-zinc-700">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">{rule.filename}</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Source: {rule.source} &middot; {fmtBytes(rule.file_size)}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-zinc-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12"><Spinner size={24} /></div>
          ) : (
            <pre className="text-sm font-mono text-zinc-300 whitespace-pre-wrap break-all">{content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main page ── */
export function YaraRules() {
  const qc = useQueryClient();
  const toast = useToastHelpers();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filter, setFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [viewingRule, setViewingRule] = useState<YaraRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<YaraRule | null>(null);
  const [showInfoTooltip, setShowInfoTooltip] = useState(false);

  /* ── Queries ── */
  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["yara-rules"],
    queryFn: () => listYaraRules(),
    refetchInterval: 30_000,
  });

  /* ── Mutations ── */
  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadYaraRule(file),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["yara-rules"] }); toast.success(`Uploaded ${r.filename}`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteYaraRule(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["yara-rules"] }); toast.success("Rule deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => toggleYaraRule(id, enabled),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["yara-rules"] }); toast.success(`${r.filename} ${r.enabled ? "enabled" : "disabled"}`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const batchToggleMutation = useMutation({
    mutationFn: ({ enabled, source }: { enabled: boolean; source?: string }) => batchToggleYaraRules(enabled, source),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["yara-rules"] });
      toast.success(`${r.updated} rules ${r.enabled ? "enabled" : "disabled"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const syncMutation = useMutation({
    mutationFn: syncYaraRulesFromGithub,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["yara-rules"] });
      toast.success(`Synced: ${r.added} added, ${r.updated} updated (${r.total_linux_rules} Linux rules found)`);
      if (r.errors.length) toast.error(`${r.errors.length} download errors`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── Filtering ── */
  const filtered = rules.filter((r) => {
    if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
    if (filter && !r.filename.toLowerCase().includes(filter.toLowerCase()) && !r.name.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const enabledCount = rules.filter((r) => r.enabled).length;
  const allEnabled = rules.length > 0 && enabledCount === rules.length;
  const allDisabled = rules.length > 0 && enabledCount === 0;
  const readOnly = isViewer();

  /* ── File upload handler ── */
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    for (const f of Array.from(files)) {
      uploadMutation.mutate(f);
    }
    e.target.value = "";
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950 p-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-3">
            <ShieldAlert className="w-7 h-7 text-amber-400" />
            YARA Rules
          </h1>
          <span className="text-sm text-zinc-400">
            {rules.length} rules ({enabledCount} enabled)
          </span>
          {/* Info tooltip */}
          <div className="relative">
            <button
              onClick={() => setShowInfoTooltip(!showInfoTooltip)}
              className="p-1 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-500 hover:text-amber-400"
              title="How YARA rules work"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            {showInfoTooltip && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowInfoTooltip(false)} />
                <div className="absolute left-0 top-full mt-2 z-50 w-80 rounded-lg border border-amber-500/20 bg-zinc-900 p-3 shadow-xl text-sm text-zinc-400">
                  <p className="font-medium text-amber-300 mb-1">Where are YARA rules stored?</p>
                  <p className="leading-relaxed">
                    Rules are stored in the <strong className="text-zinc-300">database</strong>. When a scan is triggered,
                    all <strong className="text-zinc-300">enabled</strong> rules are combined and sent to the agent.
                    The agent writes them to a temp file, runs the scan, and deletes the file.
                    Upload custom <code className="text-amber-300/80 bg-amber-500/10 px-1 rounded">.yar</code> files
                    or sync from Elastic&apos;s GitHub.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => batchToggleMutation.mutate({ enabled: true })}
            disabled={batchToggleMutation.isPending || allEnabled || readOnly}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30",
              (batchToggleMutation.isPending || allEnabled) && "opacity-50 cursor-not-allowed"
            )}
            title="Enable all rules"
          >
            <Power className="w-3.5 h-3.5" /> Enable All
          </button>
          <button
            onClick={() => batchToggleMutation.mutate({ enabled: false })}
            disabled={batchToggleMutation.isPending || allDisabled || readOnly}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              "bg-zinc-700/40 text-zinc-300 border border-zinc-600/30 hover:bg-zinc-700/60",
              (batchToggleMutation.isPending || allDisabled) && "opacity-50 cursor-not-allowed"
            )}
            title="Disable all rules"
          >
            <PowerOff className="w-3.5 h-3.5" /> Disable All
          </button>
          <div className="w-px h-6 bg-zinc-700 mx-1" />
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || readOnly}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              "bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/30",
              syncMutation.isPending && "opacity-50 cursor-not-allowed"
            )}
          >
            {syncMutation.isPending ? <Spinner size={12} /> : <Github className="w-3.5 h-3.5" />}
            Sync Elastic
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending || readOnly}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              "bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/30",
              uploadMutation.isPending && "opacity-50 cursor-not-allowed"
            )}
          >
            {uploadMutation.isPending ? <Spinner size={12} /> : <Upload className="w-3.5 h-3.5" />}
            Upload
          </button>
          <input ref={fileInputRef} type="file" accept=".yar,.yara" multiple className="hidden" onChange={handleFileUpload} />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter rules..."
            className="w-full pl-10 pr-4 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          />
        </div>
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded-lg p-0.5">
          {[
            { key: "all", label: "All" },
            { key: "upload", label: "Uploaded" },
            { key: "elastic_github", label: "Elastic" },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSourceFilter(opt.key)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                sourceFilter === opt.key ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Rules table - scrollable */}
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
        {isLoading ? (
          <div className="flex items-center justify-center py-20"><Spinner size={24} /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
            <ShieldAlert className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-lg font-medium">No YARA rules found</p>
            <p className="text-sm mt-1">Upload rules or sync from Elastic&apos;s GitHub repository</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-zinc-900 z-10">
              <tr className="border-b border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-wider">
                <th className="text-left py-2 px-3 pl-4 w-12">On</th>
                <th className="text-left py-2 px-3">Rule</th>
                <th className="text-left py-2 px-3 w-20">Source</th>
                <th className="text-left py-2 px-3 w-16">Size</th>
                <th className="text-right py-2 px-3 pr-4 w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((rule) => (
                <tr key={rule.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/30 transition-colors group">
                  <td className="py-1.5 px-3 pl-4">
                    <button
                      onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
                      className="transition-colors hover:opacity-80"
                      title={rule.enabled ? "Disable" : "Enable"}
                      disabled={readOnly}
                    >
                      {rule.enabled ? (
                        <ToggleRight className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="w-5 h-5 text-zinc-600" />
                      )}
                    </button>
                  </td>
                  <td className="py-1.5 px-3">
                    <span className={cn("text-sm", rule.enabled ? "text-zinc-200" : "text-zinc-500")}>{rule.name}</span>
                    <span className="text-[10px] text-zinc-600 ml-2 font-mono">{rule.filename}</span>
                  </td>
                  <td className="py-1.5 px-3">
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border", SOURCE_COLORS[rule.source] || "text-zinc-400")}>
                      {rule.source === "elastic_github" ? "Elastic" : "Upload"}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-xs text-zinc-500">{fmtBytes(rule.file_size)}</td>
                  <td className="py-1.5 px-3 pr-4">
                    <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setViewingRule(rule)}
                        className="p-1 hover:bg-zinc-700 rounded transition-colors text-zinc-400 hover:text-zinc-200"
                        title="View rule"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          getYaraRuleContent(rule.id).then((content) => {
                            const blob = new Blob([content], { type: "text/plain" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = rule.filename;
                            a.click();
                            URL.revokeObjectURL(url);
                          });
                        }}
                        className="p-1 hover:bg-zinc-700 rounded transition-colors text-zinc-400 hover:text-zinc-200"
                        title="Download rule"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {!readOnly && (
                      <button
                        onClick={() => setDeleteTarget(rule)}
                        className="p-1 hover:bg-red-900/30 rounded transition-colors text-zinc-400 hover:text-red-400"
                        title="Delete rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {viewingRule && <RuleViewerModal rule={viewingRule} onClose={() => setViewingRule(null)} />}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) { deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null); } }}
        title="Delete YARA Rule"
        message={`Delete "${deleteTarget?.filename}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
