import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings as SettingsIcon,
  Server,
  Check,
  Key,
  Eye,
  EyeOff,
  RefreshCw,
  Zap,
  Brain,
  Cloud,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  HardDrive,
  Database,
  Search,
  Save,
  Cpu,
  Info,
} from "lucide-react";
import { Spinner } from "@/components/ui/Loader";
import { Input } from "@/components/ui/Input";
import {
  listProviders,
  getModels,
  setActiveProvider,
  updateProviderConfig,
  testProvider,
  listEmbeddingProviders,
  setActiveEmbeddingProvider,
  listEmbeddingModels,
  getProcessingSettings,
  updateProcessingSettings,
  getLocalEmbeddingModels,
  type ProviderInfo,
  type ProcessingSettings,
  API_BASE_URL,
} from "@/services/api";
import { getAuthHeader } from "@/stores/authStore";

interface ModelOption {
  id: string;
  name: string;
  description?: string;
  recommended?: boolean;
}

type SettingsTab = "providers" | "embeddings" | "advanced" | "storage" | "about";

// Provider metadata with icon, description, and available models
const PROVIDER_INFO: Record<string, { 
  name: string; 
  icon: typeof Server; 
  color: string; 
  description: string; 
  docsUrl: string;
  models: ModelOption[];
}> = {
  ollama: {
    name: "Ollama",
    icon: Server,
    color: "text-blue-500",
    description: "Local LLM server - free, private, no API key required",
    docsUrl: "https://ollama.ai",
    models: [], // Fetched dynamically
  },
  openai: {
    name: "OpenAI",
    icon: Brain,
    color: "text-green-500",
    description: "GPT-4, GPT-3.5 - powerful, reliable, widely used",
    docsUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-4o", name: "GPT-4o", description: "Most capable, multimodal", recommended: true },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", description: "Fast and affordable" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo", description: "Fast GPT-4" },
      { id: "gpt-4", name: "GPT-4", description: "Original GPT-4" },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", description: "Fast and cheap" },
    ],
  },
  gemini: {
    name: "Google Gemini",
    icon: Cloud,
    color: "text-yellow-500",
    description: "Gemini Pro/Flash - fast, good at reasoning",
    docsUrl: "https://aistudio.google.com/app/apikey",
    models: [
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", description: "Most capable", recommended: true },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", description: "Fast and efficient" },
      { id: "gemini-1.5-flash-8b", name: "Gemini 1.5 Flash 8B", description: "Lightweight" },
      { id: "gemini-pro", name: "Gemini Pro", description: "Previous generation" },
    ],
  },
  claude: {
    name: "Anthropic Claude",
    icon: Zap,
    color: "text-purple-500",
    description: "Claude 3.5 - excellent for analysis and reasoning",
    docsUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", description: "Best for analysis", recommended: true },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", description: "Fast and affordable" },
      { id: "claude-3-opus-20240229", name: "Claude 3 Opus", description: "Most capable" },
      { id: "claude-3-sonnet-20240229", name: "Claude 3 Sonnet", description: "Balanced" },
      { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", description: "Fastest" },
    ],
  },
};

// Tab configuration
const TABS: { id: SettingsTab; label: string; icon: typeof Brain }[] = [
  { id: "providers", label: "AI Providers", icon: Brain },
  { id: "embeddings", label: "Embeddings", icon: Cpu },
  { id: "advanced", label: "Advanced", icon: HardDrive },
  { id: "storage", label: "Storage", icon: Database },
  { id: "about", label: "About", icon: Info },
];



interface StorageReport {
  db_bytes: number;
  chroma_bytes: number;
  uploads_bytes: number;
  total_bytes: number;
  total_gb: number;
  max_gb: number;
  warning: boolean;
}

function StorageTab() {
  const queryClient = useQueryClient();
  const [confirmCleanup, setConfirmCleanup] = useState(false);

  const { data: report, isLoading } = useQuery<StorageReport>({
    queryKey: ["storage-report"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/admin/storage`, { headers: getAuthHeader() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE_URL}/admin/cleanup/run`, { method: "POST", headers: getAuthHeader() });
      if (!res.ok) throw new Error("Cleanup failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["storage-report"] });
      setConfirmCleanup(false);
    },
  });

  const totalMb = (report?.total_bytes ?? 0) / (1024 * 1024);
  const thresholdMb = (report?.max_gb ?? 5) * 1024;
  const pct = thresholdMb > 0 ? Math.min(100, (totalMb / thresholdMb) * 100) : 0;

  return (
    <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
        <h2 className="font-semibold text-text-primary">Storage Management</h2>
        {!confirmCleanup ? (
          <button className="px-3 py-1.5 text-xs font-medium bg-bg-elevated text-text-secondary border border-border-default rounded-lg hover:bg-bg-hover transition-colors" onClick={() => setConfirmCleanup(true)}>
            Run Cleanup
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Delete expired data?</span>
            <button
              className="px-3 py-1.5 text-xs font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
              onClick={() => cleanupMutation.mutate()}
              disabled={cleanupMutation.isPending}
            >
              {cleanupMutation.isPending ? <><Spinner className="w-3 h-3 inline mr-1" />Cleaning...</> : "Confirm"}
            </button>
            <button className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors" onClick={() => setConfirmCleanup(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      <div className="p-5 space-y-6">
        {isLoading ? (
          <p className="text-text-muted text-sm">Loading storage info...</p>
        ) : report ? (
          <>
            {/* Usage bar */}
            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-text-muted">
                  Total: <span className="text-text-primary font-medium">{totalMb.toFixed(1)} MB</span>
                </span>
                <span className="text-text-muted">
                  Warning at {(report?.max_gb ?? 5)} GB
                </span>
              </div>
              <div className="h-3 bg-bg-base rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    report?.warning ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-brand-primary"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {report?.warning && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> Storage above warning threshold
                </p>
              )}
            </div>

            {/* Breakdown */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Database", value: (report?.db_bytes ?? 0) / (1024 * 1024), icon: Database, color: "text-blue-400" },
                { label: "Embeddings (ChromaDB)", value: (report?.chroma_bytes ?? 0) / (1024 * 1024), icon: Search, color: "text-purple-400" },
                { label: "Uploads", value: (report?.uploads_bytes ?? 0) / (1024 * 1024), icon: HardDrive, color: "text-cyan-400" },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="bg-bg-base rounded-lg p-4 text-center">
                  <Icon className={`h-5 w-5 mx-auto mb-2 ${color}`} />
                  <p className="text-lg font-bold text-text-primary">{(value ?? 0).toFixed(1)} MB</p>
                  <p className="text-xs text-text-muted">{label}</p>
                </div>
              ))}
            </div>

            {/* Cleanup result */}
            {cleanupMutation.data && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-xs text-green-400">
                Cleanup complete — removed {cleanupMutation.data.expired_sessions ?? 0} expired sessions,{" "}
                {cleanupMutation.data.orphaned_uploads ?? 0} orphaned uploads,{" "}
                {cleanupMutation.data.expired_tokens ?? 0} expired tokens.
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function Settings() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SettingsTab>("providers");
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [modelInputs, setModelInputs] = useState<Record<string, string>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string } | null>>({});
  const [processingForm, setProcessingForm] = useState<Partial<ProcessingSettings>>({});
  const [processingDirty, setProcessingDirty] = useState(false);

  // Queries
  const { data: providersData, isLoading: loadingProviders } = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });

  const { data: modelData } = useQuery({
    queryKey: ["models"],
    queryFn: getModels,
  });

  const { data: embeddingProviders } = useQuery({
    queryKey: ["embedding-providers"],
    queryFn: listEmbeddingProviders,
  });

  const { data: embeddingModels } = useQuery({
    queryKey: ["embedding-models"],
    queryFn: listEmbeddingModels,
  });

  const { data: processingSettings, isLoading: loadingProcessing } = useQuery({
    queryKey: ["processing-settings"],
    queryFn: getProcessingSettings,
  });

  const { data: localEmbeddingInfo, isLoading: loadingLocalEmbeddings } = useQuery({
    queryKey: ["local-embedding-models"],
    queryFn: getLocalEmbeddingModels,
  });

  // Mutations
  const setProviderMutation = useMutation({
    mutationFn: setActiveProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: ({ provider, config }: { provider: string; config: Record<string, unknown> }) =>
      updateProviderConfig(provider, config),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
      setApiKeyInputs((prev) => ({ ...prev, [variables.provider]: "" }));
    },
  });

  const testProviderMutation = useMutation({
    mutationFn: testProvider,
    onSuccess: (data, provider) => {
      setTestResults((prev) => ({ ...prev, [provider]: data }));
    },
    onError: (error, provider) => {
      setTestResults((prev) => ({
        ...prev,
        [provider]: { success: false, message: (error as Error).message },
      }));
    },
  });

  const setEmbeddingProviderMutation = useMutation({
    mutationFn: setActiveEmbeddingProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["embedding-providers"] });
      queryClient.invalidateQueries({ queryKey: ["embedding-models"] });
    },
  });

  const updateProcessingMutation = useMutation({
    mutationFn: updateProcessingSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["processing-settings"] });
      setProcessingDirty(false);
    },
  });

  const handleSaveApiKey = (provider: string) => {
    const apiKey = apiKeyInputs[provider];
    if (apiKey) {
      updateConfigMutation.mutate({ provider, config: { api_key: apiKey } });
    }
  };

  const handleSaveModel = (provider: string, model: string) => {
    updateConfigMutation.mutate({ provider, config: { model } });
  };

  const handleTestProvider = (provider: string) => {
    setTestResults((prev) => ({ ...prev, [provider]: null }));
    testProviderMutation.mutate(provider);
  };

  const handleProcessingChange = (key: keyof ProcessingSettings, value: number | boolean | string) => {
    setProcessingForm((prev) => ({ ...prev, [key]: value }));
    setProcessingDirty(true);
  };

  const handleSaveProcessingSettings = () => {
    updateProcessingMutation.mutate(processingForm);
  };

  const handleEmbeddingModelChange = async (modelId: string) => {
    // Update form and mark dirty
    handleProcessingChange("embedding_model", modelId);
  };

  const getProcessingValue = <K extends keyof ProcessingSettings>(key: K): ProcessingSettings[K] => {
    if (processingForm[key] !== undefined) {
      return processingForm[key] as ProcessingSettings[K];
    }
    return processingSettings?.[key] as ProcessingSettings[K] ?? (typeof key === 'string' && key === 'embedding_model' ? '' : 0) as ProcessingSettings[K];
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-primary/10 rounded-xl flex items-center justify-center">
            <SettingsIcon className="w-5 h-5 text-brand-primary" />
          </div>
          <div>
            <h1 className="text-xl font-heading font-semibold">Settings</h1>
            <p className="text-sm text-text-muted">Configure AI providers and processing options</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 bg-bg-elevated rounded-xl">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? "bg-bg-surface text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary hover:bg-bg-surface/50"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {activeTab === "providers" && (
        <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border-subtle">
            <h2 className="font-semibold text-text-primary">LLM Providers</h2>
            <p className="text-sm text-text-muted mt-0.5">Select and configure your AI provider for analysis</p>
          </div>

          {loadingProviders ? (
            <div className="p-8 text-center text-text-muted">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
              Loading providers...
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {providersData?.providers?.map((provider: ProviderInfo) => {
                const info = PROVIDER_INFO[provider.type];
                const Icon = info?.icon || Server;
                const isActive = provider.active;
                const isExpanded = expandedProvider === provider.type;
                const testResult = testResults[provider.type];
                const ollamaModels: string[] = provider.type === "ollama" ? modelData?.models || [] : [];
                const availableModels: ModelOption[] = provider.type === "ollama" 
                  ? ollamaModels.map((m: string) => ({ id: m, name: m }))
                  : info?.models || [];

                return (
                  <div key={provider.type} className="overflow-hidden">
                    {/* Provider Header */}
                    <div
                      className={`px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-bg-hover transition-colors ${
                        isActive ? "bg-brand-primary/5" : ""
                      }`}
                      onClick={() => setExpandedProvider(isExpanded ? null : provider.type)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className={`p-2 rounded-lg bg-bg-elevated ${info?.color || ""}`}>
                            <Icon className="w-5 h-5" />
                          </div>
                          {/* Connection Status Indicator */}
                          {provider.configured && (
                            <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-surface ${
                              testResult?.success === true ? "bg-success" : 
                              testResult?.success === false ? "bg-error" :
                              "bg-amber-500"
                            }`} title={testResult?.success === true ? "Connected" : testResult?.success === false ? "Connection failed" : "Not tested"} />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{info?.name || provider.type}</span>
                            {isActive && (
                              <span className="text-xs px-2 py-0.5 bg-brand-primary/20 text-brand-primary rounded-full">
                                Active
                              </span>
                            )}
                            {provider.configured && (
                              <span className="text-xs px-2 py-0.5 bg-success/20 text-success rounded-full">
                                Configured
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-text-muted mt-0.5">
                            {provider.model || "No model selected"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isActive && provider.configured && (
                          <button
                            className="px-3 py-1.5 text-xs font-medium bg-bg-elevated text-text-secondary border border-border-default rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              setProviderMutation.mutate(provider.type);
                            }}
                            disabled={setProviderMutation.isPending}
                          >
                            Activate
                          </button>
                        )}
                        <ChevronDown className={`w-5 h-5 text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="px-5 py-4 bg-bg-base border-t border-border-subtle space-y-4">
                        <p className="text-sm text-text-secondary">{info?.description}</p>

                        {/* Test Result */}
                        {testResult && (
                          <div
                            className={`p-3 rounded-lg text-sm ${
                              testResult.success ? "bg-success/10 text-success" : "bg-error/10 text-error"
                            }`}
                          >
                            {testResult.message}
                          </div>
                        )}

                        {/* API Key (non-Ollama) */}
                        {provider.type !== "ollama" && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Key className="w-4 h-4 text-text-muted" />
                                <span className="text-sm font-medium">API Key</span>
                              </div>
                              <a
                                href={info?.docsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-brand-primary hover:underline flex items-center gap-1"
                              >
                                Get API Key <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                            <div className="flex gap-2">
                              <div className="relative flex-1">
                                <Input
                                  type={showApiKeys[provider.type] ? "text" : "password"}
                                  placeholder={provider.configured ? "••••••••••••" : "Enter API key"}
                                  value={apiKeyInputs[provider.type] || ""}
                                  onChange={(e) =>
                                    setApiKeyInputs((prev) => ({
                                      ...prev,
                                      [provider.type]: e.target.value,
                                    }))
                                  }
                                  className="pr-10 font-mono text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowApiKeys((prev) => ({
                                      ...prev,
                                      [provider.type]: !prev[provider.type],
                                    }))
                                  }
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                                >
                                  {showApiKeys[provider.type] ? (
                                    <EyeOff className="w-4 h-4" />
                                  ) : (
                                    <Eye className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                              <button
                                className="px-3 py-1.5 text-xs font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
                                onClick={() => handleSaveApiKey(provider.type)}
                                disabled={!apiKeyInputs[provider.type] || updateConfigMutation.isPending}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Model Selection */}
                        <div>
                          <label className="block text-sm font-medium mb-2">Model</label>
                          {provider.type === "ollama" && ollamaModels.length === 0 ? (
                            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                              <div className="flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                                <div className="text-sm">
                                  <p className="font-medium text-amber-500">No models found</p>
                                  <p className="text-text-muted text-xs mt-1">
                                    Make sure Ollama is running. Install models with: <code className="bg-bg-elevated px-1 rounded">ollama pull llama3.1</code>
                                  </p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {/* Custom model input for cloud providers, select for Ollama */}
                              {provider.type === "ollama" ? (
                                <select
                                  value={modelInputs[provider.type] || provider.model || ""}
                                  onChange={(e) => setModelInputs(prev => ({ ...prev, [provider.type]: e.target.value }))}
                                  className="w-full px-3 py-2 bg-bg-elevated border border-border-default rounded-lg text-sm focus:outline-none focus:border-brand-primary"
                                >
                                  <option value="">Select a model...</option>
                                  {availableModels.map((model) => (
                                    <option key={model.id} value={model.id}>
                                      {model.name} {model.description ? `- ${model.description}` : ""}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="space-y-3">
                                  <Input
                                    type="text"
                                    placeholder="Enter model name or click a suggestion below"
                                    value={modelInputs[provider.type] || provider.model || ""}
                                    onChange={(e) => setModelInputs(prev => ({ ...prev, [provider.type]: e.target.value }))}
                                    className="font-mono text-sm"
                                  />
                                  
                                  {/* Model suggestions with recommended badges */}
                                  <div className="flex flex-wrap gap-2">
                                    {availableModels.map((model) => (
                                      <button
                                        key={model.id}
                                        onClick={() => setModelInputs(prev => ({ ...prev, [provider.type]: model.id }))}
                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                                          (modelInputs[provider.type] || provider.model) === model.id
                                            ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
                                            : 'border-border-default hover:border-border-strong text-text-secondary hover:text-text-primary'
                                        }`}
                                      >
                                        {model.recommended && (
                                          <span className="text-amber-400">★</span>
                                        )}
                                        {model.name}
                                      </button>
                                    ))}
                                  </div>
                                  <p className="text-xs text-text-muted">
                                    <span className="text-amber-400">★</span> = Recommended for forensic analysis
                                  </p>
                                </div>
                              )}
                              {modelInputs[provider.type] && modelInputs[provider.type] !== provider.model && (
                                <button
                                  className="px-3 py-1.5 text-xs font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
                                  onClick={() => handleSaveModel(provider.type, modelInputs[provider.type])}
                                  disabled={updateConfigMutation.isPending}
                                >
                                  <Check className="w-4 h-4 inline mr-1" />
                                  Save Model
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Test Button */}
                        <div className="pt-3 border-t border-border-subtle">
                          <button
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-bg-elevated text-text-secondary border border-border-default rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
                            onClick={() => handleTestProvider(provider.type)}
                            disabled={testProviderMutation.isPending}
                          >
                            <RefreshCw className={`w-4 h-4 ${testProviderMutation.isPending ? "animate-spin" : ""}`} />
                            Test Connection
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Embeddings Tab */}
        {activeTab === "embeddings" && (
        <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border-subtle">
            <h2 className="font-semibold text-text-primary">Embeddings</h2>
            <p className="text-sm text-text-muted mt-0.5">Used for semantic search in your data</p>
          </div>
          
          <div className="p-5 space-y-3">
            {embeddingProviders?.providers?.map((provider: ProviderInfo) => {
              const isActive = provider.active;
              const info = PROVIDER_INFO[provider.type];

              return (
                <button
                  key={provider.type}
                  onClick={() => setEmbeddingProviderMutation.mutate(provider.type)}
                  disabled={isActive || setEmbeddingProviderMutation.isPending}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                    isActive
                      ? "border-brand-primary bg-brand-primary/5"
                      : "border-border-default hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded ${info?.color || ""}`}>
                      {provider.type === "ollama" ? <Server className="w-4 h-4" /> : <Brain className="w-4 h-4" />}
                    </div>
                    <div>
                      <span className="font-medium text-sm">{info?.name || provider.type}</span>
                      {provider.model && (
                        <p className="text-xs text-text-muted font-mono">{provider.model}</p>
                      )}
                    </div>
                  </div>
                  {isActive && (
                    <span className="text-xs px-2 py-1 bg-success/10 text-success rounded">Active</span>
                  )}
                </button>
              );
            })}

            {embeddingModels && (
              <div className="pt-3 border-t border-border-subtle">
                <p className="text-xs text-text-muted">
                  Current: <span className="font-mono">{embeddingModels.current}</span>
                  {" • "}Dimensions: {embeddingModels.dimension}
                </p>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Advanced Tab */}
        {activeTab === "advanced" && (
        <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-text-primary">Advanced Settings</h2>
              <p className="text-sm text-text-muted">File limits, RAG parameters, embedding models</p>
            </div>
            {processingDirty && (
              <button
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
                onClick={handleSaveProcessingSettings}
                disabled={updateProcessingMutation.isPending}
              >
                <Save className="w-4 h-4" />
                Save Changes
              </button>
            )}
          </div>
          
          {loadingProcessing ? (
            <div className="p-8 text-center text-text-muted">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
              Loading settings...
            </div>
          ) : (
            <div className="p-5 space-y-6">
              {/* File Size Limits */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Database className="w-4 h-4 text-text-muted" />
                  File Size Limits
                </h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">
                      Max Upload Size (MB)
                    </label>
                    <Input
                      type="number"
                      min={10}
                      max={10000}
                      value={getProcessingValue("max_file_size_mb") as number}
                      onChange={(e) => handleProcessingChange("max_file_size_mb", parseInt(e.target.value) || 500)}
                      className="font-mono"
                    />
                    <p className="text-xs text-text-muted mt-1">Maximum archive size for upload</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">
                      Max File for Indexing (MB)
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={getProcessingValue("max_individual_file_mb") as number}
                      onChange={(e) => handleProcessingChange("max_individual_file_mb", parseInt(e.target.value) || 5)}
                      className="font-mono"
                    />
                    <p className="text-xs text-text-muted mt-1">Skip files larger than this</p>
                  </div>
                </div>
              </div>

              {/* RAG Settings */}
              <div className="space-y-4 pt-4 border-t border-border-subtle">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Search className="w-4 h-4 text-text-muted" />
                  RAG & Search Settings
                </h3>

                {/* Embedding Model Selector */}
                <div className="p-4 bg-bg-primary rounded-lg border border-border-subtle">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <label className="block text-sm font-medium text-text-primary">
                        Embedding Model
                      </label>
                      <p className="text-xs text-text-muted">
                        Model used for vector search • Changing requires re-parsing sessions
                      </p>
                    </div>
                    {localEmbeddingInfo && (
                      <div className="text-right text-xs text-text-muted">
                        <span className={localEmbeddingInfo.device === 'cuda' ? 'text-success' : 'text-warning'}>
                          {localEmbeddingInfo.device === 'cuda' ? '🚀 GPU' : '⚠️ CPU'}
                        </span>
                        {' • '}{localEmbeddingInfo.dimension} dim
                      </div>
                    )}
                  </div>
                  
                  {loadingLocalEmbeddings ? (
                    <div className="text-sm text-text-muted">Loading models...</div>
                  ) : (
                    <div className="space-y-2">
                      {localEmbeddingInfo?.models.map((model) => {
                        const isSelected = (getProcessingValue("embedding_model") || localEmbeddingInfo.current) === model.id;
                        const isCurrent = localEmbeddingInfo.current === model.id;
                        return (
                          <button
                            key={model.id}
                            onClick={() => handleEmbeddingModelChange(model.id)}
                            className={`w-full text-left p-3 rounded-lg border transition-colors ${
                              isSelected
                                ? 'border-brand-primary bg-brand-primary/5'
                                : 'border-border-subtle hover:border-border-default hover:bg-bg-surface'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="font-medium text-sm">{model.name}</span>
                                <span className="ml-2 text-xs text-text-muted font-mono">({model.dimension} dim)</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {isCurrent && (
                                  <span className="text-xs px-2 py-0.5 bg-success/10 text-success rounded">Active</span>
                                )}
                                {isSelected && !isCurrent && (
                                  <span className="text-xs px-2 py-0.5 bg-warning/10 text-warning rounded">Pending</span>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-text-muted mt-1">{model.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  
                  {processingDirty && getProcessingValue("embedding_model") !== localEmbeddingInfo?.current && (
                    <p className="mt-3 text-xs text-warning flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Save settings and reload model to apply changes. Existing sessions may need re-parsing.
                    </p>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">
                      Chunk Size (tokens)
                    </label>
                    <Input
                      type="number"
                      min={128}
                      max={2048}
                      step={64}
                      value={getProcessingValue("chunk_size") as number}
                      onChange={(e) => handleProcessingChange("chunk_size", parseInt(e.target.value) || 512)}
                      className="font-mono"
                    />
                    <p className="text-xs text-text-muted mt-1">Size of text chunks for embedding</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">
                      Chunk Overlap (tokens)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={256}
                      step={10}
                      value={getProcessingValue("chunk_overlap") as number}
                      onChange={(e) => handleProcessingChange("chunk_overlap", parseInt(e.target.value) || 50)}
                      className="font-mono"
                    />
                    <p className="text-xs text-text-muted mt-1">Overlap between consecutive chunks</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">
                      Hot Cache Size
                    </label>
                    <Input
                      type="number"
                      min={100}
                      max={10000}
                      step={100}
                      value={getProcessingValue("hot_cache_size") as number}
                      onChange={(e) => handleProcessingChange("hot_cache_size", parseInt(e.target.value) || 1000)}
                      className="font-mono"
                    />
                    <p className="text-xs text-text-muted mt-1">Max chunks in memory cache</p>
                  </div>
                  
                  <div className="space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={getProcessingValue("enable_hybrid_search") as boolean}
                        onChange={(e) => handleProcessingChange("enable_hybrid_search", e.target.checked)}
                        className="w-4 h-4 rounded border-border-default text-brand-primary focus:ring-brand-primary"
                      />
                      <span className="text-sm">Enable Hybrid Search (BM25 + Vector)</span>
                    </label>
                    
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={getProcessingValue("enable_query_expansion") as boolean}
                        onChange={(e) => handleProcessingChange("enable_query_expansion", e.target.checked)}
                        className="w-4 h-4 rounded border-border-default text-brand-primary focus:ring-brand-primary"
                      />
                      <span className="text-sm">Enable Query Expansion</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Timeline Settings */}
              <div className="space-y-4 pt-4 border-t border-border-subtle">
                <h3 className="text-sm font-medium">Timeline Settings</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">
                      Max Timeline Events
                    </label>
                    <Input
                      type="number"
                      min={1000}
                      max={100000}
                      step={1000}
                      value={getProcessingValue("timeline_max_events") as number}
                      onChange={(e) => handleProcessingChange("timeline_max_events", parseInt(e.target.value) || 10000)}
                      className="font-mono"
                    />
                    <p className="text-xs text-text-muted mt-1">Limit events in timeline view</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">
                      Max Bodyfile Events
                    </label>
                    <Input
                      type="number"
                      min={1000}
                      max={50000}
                      step={1000}
                      value={getProcessingValue("bodyfile_max_events") as number}
                      onChange={(e) => handleProcessingChange("bodyfile_max_events", parseInt(e.target.value) || 5000)}
                      className="font-mono"
                    />
                    <p className="text-xs text-text-muted mt-1">Limit filesystem events from bodyfile</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Storage Tab */}
        {activeTab === "storage" && <StorageTab />}

        {/* About Tab */}
        {activeTab === "about" && (
        <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border-subtle">
            <h2 className="font-semibold text-text-primary">About</h2>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-sm text-text-secondary">
              UAC AI Parser is an AI-powered forensic analysis tool for{" "}
              <a href="https://github.com/tclahr/uac" target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline">
                UAC
              </a>{" "}
              (Unix-like Artifacts Collector) outputs.
            </p>
            
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border-subtle">
              <div>
                <p className="text-xs text-text-muted uppercase font-medium mb-1">Version</p>
                <p className="text-sm text-text-primary">1.0.0</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase font-medium mb-1">License</p>
                <p className="text-sm text-text-primary">MIT</p>
              </div>
            </div>
            
            <div className="pt-4 border-t border-border-subtle">
              <p className="text-xs text-text-muted uppercase font-medium mb-2">Supported AI Providers</p>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-xs rounded">Ollama</span>
                <span className="px-2 py-1 bg-green-500/10 text-green-400 text-xs rounded">OpenAI</span>
                <span className="px-2 py-1 bg-yellow-500/10 text-yellow-400 text-xs rounded">Google Gemini</span>
                <span className="px-2 py-1 bg-purple-500/10 text-purple-400 text-xs rounded">Anthropic Claude</span>
              </div>
            </div>
            
            <div className="pt-4 border-t border-border-subtle">
              <a 
                href="https://github.com/tclahr/uac" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-brand-primary hover:underline"
              >
                <ExternalLink className="w-4 h-4" />
                View UAC Project on GitHub
              </a>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
