/**
 * SuggestedQuestions - Shows AI-generated query suggestions based on session data
 */
import { useQuery } from "@tanstack/react-query";
import { Lightbulb, ArrowRight, RefreshCw, Sparkles } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { API_BASE_URL } from "@/services/api";
import { getAuthHeader } from "@/stores/authStore";

interface SuggestedQuestionsProps {
  sessionId: string | null;
  onSelectQuestion: (question: string) => void;
}

interface SuggestionsResponse {
  session_id: string;
  questions: string[];
  generated: boolean;
  context?: {
    hostname?: string;
    categories?: string[];
    entity_types?: string[];
  };
  error?: string;
}

// Fallback questions if API fails
const fallbackQuestions = [
  "What are the key indicators of compromise?",
  "Show failed login attempts and authentication events",
  "List suspicious network connections",
  "What persistence mechanisms are present?",
  "Summarize critical security events",
  "What should I investigate further?",
];

async function fetchSuggestions(sessionId: string, refresh = false): Promise<SuggestionsResponse> {
  const url = new URL(`${API_BASE_URL}/analyze/suggestions`);
  url.searchParams.set("session_id", sessionId);
  if (refresh) url.searchParams.set("refresh", "true");
  
  const response = await fetch(url.toString(), { headers: getAuthHeader() });
  if (!response.ok) {
    throw new Error("Failed to fetch suggestions");
  }
  return response.json();
}

export function SuggestedQuestions({ sessionId, onSelectQuestion }: SuggestedQuestionsProps) {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["ai-suggestions", sessionId],
    queryFn: () => fetchSuggestions(sessionId!),
    enabled: !!sessionId,
    staleTime: 5 * 60 * 1000, // 5 minutes - cached on backend too
    retry: 1,
  });

  if (!sessionId) return null;

  const questions = data?.questions || fallbackQuestions;
  const isAIGenerated = data?.generated ?? false;
  const isRefreshing = isFetching && !isLoading;

  const handleRefresh = () => {
    // Force refresh from LLM
    fetchSuggestions(sessionId, true).then(() => {
      refetch();
    });
    refetch();
  };

  return (
    <Card className="p-0">
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            {isAIGenerated ? (
              <Sparkles className="w-3.5 h-3.5 text-purple-500" />
            ) : (
              <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
            )}
            <span>Suggested Questions</span>
          </CardTitle>
          <button 
            onClick={handleRefresh}
            disabled={isFetching}
            title="Generate new suggestions"
            className="h-6 w-6 p-0 flex items-center justify-center text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </CardHeader>
      <CardContent className="py-2 px-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-3 gap-2 text-text-muted">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            <span className="text-xs">Generating suggestions...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {questions.map((question, index) => (
              <button
                key={index}
                onClick={() => onSelectQuestion(question)}
                className="flex items-start gap-1.5 p-2 text-left text-xs rounded-lg border border-border-subtle hover:border-brand-primary hover:bg-brand-primary/5 transition-colors group"
              >
                <ArrowRight className="w-3 h-3 text-text-muted group-hover:text-brand-primary mt-0.5 flex-shrink-0" />
                <span className="text-text-secondary group-hover:text-text-primary line-clamp-2">
                  {question}
                </span>
              </button>
            ))}
          </div>
        )}
        {isRefreshing && (
          <div className="mt-2 text-center text-xs text-text-muted">
            <Sparkles className="w-3 h-3 inline mr-1 animate-pulse" />
            Generating new suggestions...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SuggestedQuestions;
