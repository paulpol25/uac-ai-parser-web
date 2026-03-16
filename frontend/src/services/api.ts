import type {
  Investigation,
  InvestigationDetail,
  CreateInvestigationRequest,
  UpdateInvestigationRequest,
} from "@/types/investigation";
import type { AuthProvider, AuthResponse, LoginRequest, RegisterRequest, User } from "@/types/auth";
import { getAuthHeader } from "@/stores/authStore";

export const API_BASE_URL = "/api/v1";

// Helper to get headers with auth
function headers(contentType = true): HeadersInit {
  return {
    ...(contentType ? { "Content-Type": "application/json" } : {}),
    ...getAuthHeader(),
  };
}

// ===== Auth =====

export async function getAuthProviderType(): Promise<AuthProvider> {
  const response = await fetch(`${API_BASE_URL}/auth/provider`);
  if (!response.ok) return "local";
  const data = await response.json();
  return data.provider as AuthProvider;
}

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Registration failed");
  }

  return response.json();
}

export async function login(data: LoginRequest): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Login failed");
  }

  return response.json();
}

export async function logout(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: "POST",
    headers: headers(),
  });

  if (!response.ok) {
    // Ignore logout errors
  }
}

export async function getCurrentUser(): Promise<User> {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: headers(false),
  });

  if (!response.ok) {
    throw new Error("Not authenticated");
  }

  return response.json();
}

// ===== Investigations =====

export async function listInvestigations(): Promise<{ investigations: Investigation[] }> {
  const response = await fetch(`${API_BASE_URL}/investigations`, {
    headers: headers(false),
  });
  
  if (!response.ok) {
    throw new Error("Failed to list investigations");
  }
  
  return response.json();
}

export async function createInvestigation(data: CreateInvestigationRequest): Promise<Investigation> {
  const response = await fetch(`${API_BASE_URL}/investigations`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to create investigation");
  }
  
  return response.json();
}

export async function getInvestigation(id: number): Promise<InvestigationDetail> {
  const response = await fetch(`${API_BASE_URL}/investigations/${id}`, {
    headers: headers(false),
  });
  
  if (!response.ok) {
    throw new Error("Failed to get investigation");
  }
  
  return response.json();
}

export async function updateInvestigation(id: number, data: UpdateInvestigationRequest): Promise<Investigation> {
  const response = await fetch(`${API_BASE_URL}/investigations/${id}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    throw new Error("Failed to update investigation");
  }
  
  return response.json();
}

export async function deleteInvestigation(id: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/investigations/${id}`, {
    method: "DELETE",
    headers: headers(false),
  });
  
  if (!response.ok) {
    throw new Error("Failed to delete investigation");
  }
}

export async function deleteSession(investigationId: number, sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/investigations/${investigationId}/sessions/${sessionId}`, {
    method: "DELETE",
    headers: headers(false),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to delete session");
  }
}

// ===== Parse =====

export async function parseFile(file: File, investigationId?: number) {
  const formData = new FormData();
  formData.append("file", file);
  if (investigationId) {
    formData.append("investigation_id", investigationId.toString());
  }

  const authHeaders = getAuthHeader();

  const response = await fetch(`${API_BASE_URL}/parse`, {
    method: "POST",
    headers: authHeaders,
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || "Failed to parse file");
  }

  return response.json();
}

export interface ParseProgressEvent {
  type: "progress" | "keepalive" | "complete" | "error";
  step?: string;
  progress?: number;
  detail?: string;
  session_id?: string;  // Included in progress events so frontend can use it early
  result?: unknown;
  error?: string;
}

export async function parseFileWithProgress(
  file: File, 
  investigationId: number | undefined,
  onProgress: (event: ParseProgressEvent) => void,
  abortSignal?: AbortSignal
): Promise<unknown> {
  const formData = new FormData();
  formData.append("file", file);
  if (investigationId) {
    formData.append("investigation_id", investigationId.toString());
  }

  const authHeaders = getAuthHeader();
  
  // Create abort controller for timeout handling
  const controller = new AbortController();
  const signal = abortSignal || controller.signal;
  
  // Timeout for idle connection (no data for 2 minutes)
  const IDLE_TIMEOUT = 120000;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      controller.abort();
    }, IDLE_TIMEOUT);
  };

  try {
    const response = await fetch(`${API_BASE_URL}/parse/stream`, {
      method: "POST",
      headers: authHeaders,
      body: formData,
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || error.error || "Failed to parse file");
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: unknown = null;

    // Start idle timer
    resetIdleTimer();

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      // Reset idle timer on data received
      resetIdleTimer();

      buffer += decoder.decode(value, { stream: true });
      
      // Process complete events (lines ending with \n\n)
      const events = buffer.split("\n\n");
      buffer = events.pop() || ""; // Keep incomplete event in buffer

      for (const eventStr of events) {
        if (!eventStr.trim()) continue;
        
        // Parse SSE format: "data: {...}"
        const lines = eventStr.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as ParseProgressEvent;
              
              // Skip keepalive events for UI but use them for timeout reset
              if (data.type === "keepalive") {
                continue;
              }
              
              onProgress(data);
              
              if (data.type === "complete") {
                finalResult = data.result;
              } else if (data.type === "error") {
                throw new Error(data.error || "Parse failed");
              }
            } catch (e) {
              if (e instanceof SyntaxError) {
                // Silently ignore malformed SSE data
              } else {
                throw e;
              }
            }
          }
        }
      }
    }

    if (!finalResult) {
      throw new Error("Parse completed without result - connection may have been interrupted");
    }

    return finalResult;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("Upload timed out - no response from server. Please try again.");
    }
    throw e;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}

export async function getArtifacts(sessionId: string) {
  const response = await fetch(
    `${API_BASE_URL}/parse/artifacts?session_id=${sessionId}`
  );

  if (!response.ok) {
    throw new Error("Failed to get artifacts");
  }

  return response.json();
}

// ===== Analysis =====

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function queryAnalysis(
  sessionId: string,
  query: string,
  onToken: (token: string) => void,
  history?: ChatMessage[],
  _investigationContext?: string // Unused in non-agentic mode, present for API consistency
) {
  const response = await fetch(`${API_BASE_URL}/analyze/query`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ 
      session_id: sessionId, 
      query,
      history: history || []
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || "Query failed");
  }

  // Handle SSE streaming
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error("No response body");
  }

  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      // Handle SSE event format: "event: token\ndata: {...}"
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (parsed.text) {
            onToken(parsed.text);
          } else if (parsed.full_response) {
            return;
          } else if (parsed.error) {
            throw new Error(parsed.error);
          }
        } catch (e) {
          // Re-throw server errors; only ignore JSON parse failures
          if (e instanceof Error && !e.message.includes("JSON")) throw e;
        }
      }
    }
  }
}

export async function queryAgenticAnalysis(
  sessionId: string,
  query: string,
  onToken: (token: string) => void,
  history?: ChatMessage[],
  investigationContext?: string
) {
  const response = await fetch(`${API_BASE_URL}/analyze/query/agent`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ 
      session_id: sessionId, 
      query,
      history: history || [],
      investigation_context: investigationContext || ""
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || "Agentic query failed");
  }

  // Handle SSE streaming
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error("No response body");
  }

  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (parsed.text) {
            onToken(parsed.text);
          } else if (parsed.full_response) {
            return;
          } else if (parsed.error) {
            throw new Error(parsed.error);
          }
        } catch (e) {
          // Re-throw server errors; only ignore JSON parse failures
          if (e instanceof Error && !e.message.includes("JSON")) throw e;
        }
      }
    }
  }
}

export async function getSummary(sessionId: string) {
  const response = await fetch(
    `${API_BASE_URL}/analyze/summary?session_id=${sessionId}`
  );

  if (!response.ok) {
    throw new Error("Failed to get summary");
  }

  return response.json();
}

export async function getAnomalies(sessionId: string) {
  const response = await fetch(
    `${API_BASE_URL}/analyze/anomalies?session_id=${sessionId}`
  );

  if (!response.ok) {
    throw new Error("Failed to get anomalies");
  }

  return response.json();
}

// ===== Context Preview =====

export interface ChunkPreview {
  text: string;
  source: string;
  category: string;
  score: number;
}

export interface ContextPreviewResult {
  query: string;
  inferred_categories: string[];
  chunks_retrieved: number;
  chunks: ChunkPreview[];
  context_preview: string;
  retrieval_time_ms: number;
}

export async function previewContext(sessionId: string, query: string, topK: number = 5): Promise<ContextPreviewResult> {
  const response = await fetch(`${API_BASE_URL}/analyze/context-preview`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ session_id: sessionId, query, top_k: topK }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to preview context");
  }

  return response.json();
}

// ===== Session Stats =====

export interface SessionStats {
  session_id: string;
  status: string;
  hostname: string | null;
  os_type: string | null;
  original_filename: string;
  parsed_at: string | null;
  total_chunks: number;
  total_tokens: number;
  total_files: number;
  categories: Record<string, number>;
  source_types: Record<string, number>;
  top_accessed_sources: Array<{ source_file: string; category: string; access_count: number }>;
  cache_stats: { size: number; max_size: number; hits: number; misses: number; hit_rate: number };
}

export async function getSessionStats(sessionId: string): Promise<SessionStats> {
  const response = await fetch(`${API_BASE_URL}/analyze/session-stats?session_id=${sessionId}`, {
    headers: headers(false),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to get session stats");
  }

  return response.json();
}

// ===== IOC Extraction =====

export interface IOCData {
  value: string;
  type?: string;
  context?: string;
  suspicious?: boolean;
}

export interface IOCResult {
  iocs: {
    ip_addresses: IOCData[];
    domains: IOCData[];
    urls: IOCData[];
    file_hashes: IOCData[];
    file_paths: IOCData[];
    email_addresses: IOCData[];
    user_accounts: IOCData[];
    suspicious_processes: IOCData[];
    registry_keys: IOCData[];
    commands: IOCData[];
  };
  total_count: number;
  llm_analysis: string;
  chunks_analyzed: number;
}

export async function extractIOCs(sessionId: string): Promise<IOCResult> {
  const response = await fetch(`${API_BASE_URL}/analyze/extract-iocs?session_id=${sessionId}`, {
    headers: headers(false),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to extract IOCs");
  }

  return response.json();
}

// ===== Timeline =====

export async function getTimeline(
  sessionId: string,
  startDate?: string,
  endDate?: string
) {
  const params = new URLSearchParams({ session_id: sessionId });
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);

  const response = await fetch(`${API_BASE_URL}/timeline?${params}`);

  if (!response.ok) {
    throw new Error("Failed to get timeline");
  }

  return response.json();
}

// ===== Config =====

export async function getModels() {
  const response = await fetch(`${API_BASE_URL}/config/models`, {
    headers: headers(false),
  });

  if (!response.ok) {
    throw new Error("Failed to get models");
  }

  return response.json();
}

export async function setModel(model: string) {
  const response = await fetch(`${API_BASE_URL}/config/models`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ model }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to set model");
  }

  return response.json();
}

// ===== Provider Management =====

export interface ProviderInfo {
  type: string;
  name: string;
  active: boolean;
  available: boolean;
  configured: boolean;
  model: string;
}

export interface ProviderConfig {
  api_key?: string;
  api_key_set?: boolean;
  base_url?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface FullConfig {
  active_provider: string;
  active_embedding_provider: string;
  providers: Record<string, ProviderConfig>;
  embedding_providers: Record<string, ProviderConfig>;
}

export async function listProviders(): Promise<{ providers: ProviderInfo[]; active_provider: string }> {
  const response = await fetch(`${API_BASE_URL}/config/providers`, {
    headers: headers(false),
  });

  if (!response.ok) {
    throw new Error("Failed to list providers");
  }

  return response.json();
}

export async function getProviderConfig(providerType: string): Promise<{ provider: string; config: ProviderConfig }> {
  const response = await fetch(`${API_BASE_URL}/config/providers/${providerType}`, {
    headers: headers(false),
  });

  if (!response.ok) {
    throw new Error("Failed to get provider config");
  }

  return response.json();
}

export async function updateProviderConfig(providerType: string, config: Partial<ProviderConfig>): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE_URL}/config/providers/${providerType}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to update provider config");
  }

  return response.json();
}

export async function setActiveProvider(provider: string): Promise<{ message: string; active_provider: string }> {
  const response = await fetch(`${API_BASE_URL}/config/providers/active`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ provider }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to set active provider");
  }

  return response.json();
}

export async function testProvider(providerType: string): Promise<{ success: boolean; provider: string; message: string; models_available?: number }> {
  const response = await fetch(`${API_BASE_URL}/config/providers/${providerType}/test`, {
    method: "POST",
    headers: headers(),
  });

  return response.json();
}

// ===== Embedding Provider Management =====

export async function listEmbeddingProviders(): Promise<{ providers: ProviderInfo[]; active_provider: string }> {
  const response = await fetch(`${API_BASE_URL}/config/embeddings/providers`, {
    headers: headers(false),
  });

  if (!response.ok) {
    throw new Error("Failed to list embedding providers");
  }

  return response.json();
}

export async function setActiveEmbeddingProvider(provider: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE_URL}/config/embeddings/providers/active`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ provider }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to set embedding provider");
  }

  return response.json();
}

export async function listEmbeddingModels(): Promise<{ models: string[]; current: string; provider: string; dimension: number }> {
  const response = await fetch(`${API_BASE_URL}/config/embeddings/models`, {
    headers: headers(false),
  });

  if (!response.ok) {
    throw new Error("Failed to list embedding models");
  }

  return response.json();
}

export async function getFullConfig(): Promise<FullConfig> {
  const response = await fetch(`${API_BASE_URL}/config/all`, {
    headers: headers(false),
  });

  if (!response.ok) {
    throw new Error("Failed to get full config");
  }

  return response.json();
}

// ===== Processing Settings =====

export interface ProcessingSettings {
  max_file_size_mb: number;
  max_individual_file_mb: number;
  chunk_size: number;
  chunk_overlap: number;
  hot_cache_size: number;
  timeline_max_events: number;
  bodyfile_max_events: number;
  enable_hybrid_search: boolean;
  enable_query_expansion: boolean;
  embedding_model: string;
}

export async function getProcessingSettings(): Promise<ProcessingSettings> {
  const response = await fetch(`${API_BASE_URL}/config/settings/processing`, {
    headers: headers(false),
  });

  if (!response.ok) {
    throw new Error("Failed to get processing settings");
  }

  return response.json();
}

export async function updateProcessingSettings(settings: Partial<ProcessingSettings>): Promise<{ message: string; settings: ProcessingSettings }> {
  const response = await fetch(`${API_BASE_URL}/config/settings/processing`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to update processing settings");
  }

  return response.json();
}

// ===== Local Embedding Models =====

export interface LocalEmbeddingModel {
  id: string;
  name: string;
  description: string;
  dimension: number;
}

export interface LocalEmbeddingInfo {
  models: LocalEmbeddingModel[];
  current: string;
  dimension: number;
  device: string;
  available: boolean;
  error?: string;
}

export async function getLocalEmbeddingModels(): Promise<LocalEmbeddingInfo> {
  const response = await fetch(`${API_BASE_URL}/config/embeddings/local/models`, {
    headers: headers(false),
  });

  if (!response.ok) {
    throw new Error("Failed to get local embedding models");
  }

  return response.json();
}

export async function reloadLocalEmbeddingModel(): Promise<{ message: string; model: string; dimension: number; device: string }> {
  const response = await fetch(`${API_BASE_URL}/config/embeddings/local/reload`, {
    method: "POST",
    headers: headers(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to reload embedding model");
  }

  return response.json();
}

// ===== Health =====

export async function healthCheck() {
  const response = await fetch(`${API_BASE_URL}/health`);

  if (!response.ok) {
    throw new Error("Health check failed");
  }

  return response.json();
}

// Alias for consistency
export const getHealth = healthCheck;

// ===== Chats =====

export interface ChatSummary {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface ChatMessageData {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: string[];
  reasoning_steps?: string[];
  created_at: string;
}

export interface ChatDetail {
  id: number;
  title: string;
  session_id: string;
  created_at: string;
  updated_at: string;
  messages: ChatMessageData[];
}

export async function listChats(sessionId: string): Promise<{ chats: ChatSummary[] }> {
  const response = await fetch(`${API_BASE_URL}/chats?session_id=${sessionId}`, {
    headers: headers(false),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to list chats");
  }

  return response.json();
}

export async function createChat(sessionId: string, title?: string): Promise<{ id: number; title: string }> {
  const response = await fetch(`${API_BASE_URL}/chats`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ session_id: sessionId, title }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to create chat");
  }

  return response.json();
}

export async function getChat(chatId: number): Promise<ChatDetail> {
  const response = await fetch(`${API_BASE_URL}/chats/${chatId}`, {
    headers: headers(false),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to get chat");
  }

  return response.json();
}

export async function updateChat(chatId: number, title: string): Promise<{ id: number; title: string }> {
  const response = await fetch(`${API_BASE_URL}/chats/${chatId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to update chat");
  }

  return response.json();
}

export async function deleteChat(chatId: number): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/chats/${chatId}`, {
    method: "DELETE",
    headers: headers(false),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to delete chat");
  }

  return response.json();
}

export async function addChatMessage(
  chatId: number,
  role: "user" | "assistant",
  content: string,
  sources?: string[],
  reasoningSteps?: string[]
): Promise<{ id: number }> {
  const response = await fetch(`${API_BASE_URL}/chats/${chatId}/messages`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      role,
      content,
      sources,
      reasoning_steps: reasoningSteps,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to add message");
  }

  return response.json();
}

export async function getChatMessages(chatId: number): Promise<{ messages: ChatMessageData[] }> {
  const response = await fetch(`${API_BASE_URL}/chats/${chatId}/messages`, {
    headers: headers(false),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to get messages");
  }

  return response.json();
}

// ===== MITRE ATT&CK =====

export interface MitreTechnique {
  technique_id: string;
  technique_name: string;
  tactic: string;
  confidence: number;
  evidence_snippet?: string;
  evidence_chunk_id?: string;
  source_file?: string;
}

export interface MitreSummary {
  total_techniques: number;
  tactics: Record<string, MitreTechnique[]>;
  tactic_count: Record<string, number>;
}

export async function mitreScan(sessionId: string): Promise<{ techniques: MitreTechnique[]; count: number }> {
  const response = await fetch(`${API_BASE_URL}/analyze/mitre/scan`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "MITRE scan failed");
  }
  return response.json();
}

export async function getMitreSummary(sessionId: string): Promise<MitreSummary> {
  const response = await fetch(`${API_BASE_URL}/analyze/mitre/summary?session_id=${sessionId}`, {
    headers: headers(false),
  });
  if (!response.ok) throw new Error("Failed to fetch MITRE summary");
  return response.json();
}

// ===== IOC Service (investigation-level) =====

export interface IOCEntry {
  id: number;
  type: string;
  ioc_type?: string;
  value: string;
  first_seen: string;
  last_seen: string;
  session_count: number;
  occurrence_count?: number;
  sessions: string[];
  geo_country?: string;
  geo_city?: string;
  geo_asn?: string;
  context?: string;
}

export interface IOCSummaryData {
  total_iocs: number;
  by_type: Record<string, number>;
  multi_session: number;
}

export interface IOCCorrelation {
  investigation_id: number;
  total_iocs: number;
  cross_session_iocs: IOCEntry[];
  single_session_iocs: IOCEntry[];
  type_breakdown: Record<string, number>;
}

export async function iocExtract(sessionId: string): Promise<{ iocs_created: number }> {
  const response = await fetch(`${API_BASE_URL}/analyze/iocs/extract`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!response.ok) throw new Error("Failed to extract IOCs");
  return response.json();
}

export async function getIOCSummary(investigationId: number): Promise<IOCSummaryData> {
  const response = await fetch(`${API_BASE_URL}/analyze/iocs/summary?investigation_id=${investigationId}`, {
    headers: headers(false),
  });
  if (!response.ok) throw new Error("Failed to fetch IOC summary");
  return response.json();
}

export async function getIOCCorrelation(investigationId: number): Promise<IOCCorrelation> {
  const response = await fetch(`${API_BASE_URL}/analyze/iocs/correlate?investigation_id=${investigationId}`, {
    headers: headers(false),
  });
  if (!response.ok) throw new Error("Failed to correlate IOCs");
  return response.json();
}

export async function searchIOCs(investigationId: number, query: string, iocType?: string): Promise<{ results: IOCEntry[] }> {
  const response = await fetch(`${API_BASE_URL}/analyze/iocs/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ investigation_id: investigationId, query, ...(iocType ? { ioc_type: iocType } : {}) }),
  });
  if (!response.ok) throw new Error("Failed to search IOCs");
  return response.json();
}

// ===== Session Compare =====

export async function compareSessions(sessionA: string, sessionB: string) {
  const response = await fetch(`${API_BASE_URL}/analyze/compare`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ session_a: sessionA, session_b: sessionB }),
  });
  if (!response.ok) throw new Error("Failed to compare sessions");
  return response.json();
}

// ===== Entity Graph =====

export async function getGraphNeighbors(sessionId: string, entityValue: string, depth: number = 1) {
  const response = await fetch(`${API_BASE_URL}/analyze/graph/neighbors`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ session_id: sessionId, entity_value: entityValue, depth }),
  });
  if (!response.ok) throw new Error("Failed to get graph neighbors");
  return response.json();
}

export async function getGraphPath(sessionId: string, source: string, target: string) {
  const response = await fetch(`${API_BASE_URL}/analyze/graph/path`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ session_id: sessionId, source, target }),
  });
  if (!response.ok) throw new Error("Failed to get graph path");
  return response.json();
}

export async function getGraphStats(sessionId: string) {
  const response = await fetch(`${API_BASE_URL}/analyze/graph/stats?session_id=${sessionId}`, {
    headers: headers(false),
  });
  if (!response.ok) throw new Error("Failed to get graph stats");
  return response.json();
}

export async function getKillChain(sessionId: string) {
  const response = await fetch(`${API_BASE_URL}/analyze/graph/kill-chain?session_id=${sessionId}`, {
    headers: headers(false),
  });
  if (!response.ok) throw new Error("Failed to get kill chain");
  return response.json();
}

// ===== Entities =====

export async function getEntities(sessionId: string, type?: string, limit?: number) {
  const params = new URLSearchParams({ session_id: sessionId });
  if (type) params.append("type", type);
  if (limit) params.append("limit", limit.toString());
  const response = await fetch(`${API_BASE_URL}/analyze/entities?${params}`, {
    headers: headers(false),
  });
  if (!response.ok) throw new Error("Failed to get entities");
  return response.json();
}

export async function searchEntities(sessionId: string, value: string, type?: string) {
  const response = await fetch(`${API_BASE_URL}/analyze/entities/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ session_id: sessionId, value, ...(type ? { type } : {}) }),
  });
  if (!response.ok) throw new Error("Failed to search entities");
  return response.json();
}

// ===== Timeline (with auth) =====

export async function getTimelineStats(sessionId: string) {
  const response = await fetch(`${API_BASE_URL}/timeline/stats?session_id=${sessionId}`, {
    headers: headers(false),
  });
  if (!response.ok) throw new Error("Failed to get timeline stats");
  return response.json();
}

export async function getTimelineEvents(sessionId: string) {
  const response = await fetch(`${API_BASE_URL}/timeline?session_id=${sessionId}`, {
    headers: headers(false),
  });
  if (!response.ok) throw new Error("Failed to get timeline");
  return response.json();
}
