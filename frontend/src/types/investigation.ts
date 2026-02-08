/**
 * Investigation types for the frontend
 */

export interface Investigation {
  id: number;
  name: string;
  description: string | null;
  case_number: string | null;
  status: "active" | "archived" | "deleted";
  created_at: string;
  updated_at: string;
  session_count: number;
  query_count: number;
}

export interface InvestigationSession {
  id: number;
  session_id: string;
  original_filename: string;
  hostname: string | null;
  os_type: string | null;
  total_artifacts: number;
  total_chunks: number;
  status: "processing" | "searchable" | "ready" | "error" | "failed";
  parsed_at: string | null;
}

export interface InvestigationDetail extends Omit<Investigation, 'session_count' | 'query_count'> {
  sessions: InvestigationSession[];
}

export interface CreateInvestigationRequest {
  name: string;
  description?: string;
  case_number?: string;
}

export interface UpdateInvestigationRequest {
  name?: string;
  description?: string;
  case_number?: string;
  status?: "active" | "archived";
}
