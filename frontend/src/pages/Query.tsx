import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, Sparkles, AlertTriangle, FileText, PanelRightOpen, PanelRightClose, PanelLeftOpen, PanelLeftClose, FolderOpen, Database, ChevronDown, Shield, Keyboard, Bot, Zap, Plus, MessageSquare, Trash2, Info, Check, Wand2 } from "lucide-react";
import { useFocusShortcut } from "@/hooks/useKeyboardShortcuts";
import { cn } from "@/utils/cn";
import { Spinner } from "@/components/ui/Loader";
import { Textarea } from "@/components/ui/Input";
import { useSessionStore } from "@/stores/sessionStore";
import { useInvestigationStore } from "@/stores/investigationStore";
import { queryAnalysis, queryAgenticAnalysis, getSummary, getAnomalies, getInvestigation, listInvestigations, extractIOCs, listChats, createChat, getChat, deleteChat, addChatMessage, type ChatSummary } from "@/services/api";
import { ContextPreview } from "@/components/features/ContextPreview";
import { SessionInfoPanel } from "@/components/features/SessionInfoPanel";
import { SuggestedQuestions } from "@/components/features/SuggestedQuestions";
import { QueryHistory, addToQueryHistory } from "@/components/features/QueryHistory";
import { ChatMessage, type ChatMessageData } from "@/components/features/ChatMessage";
import { AgentProgress, useAgentProgress } from "@/components/features/AgentProgress";
import { useQuery } from "@tanstack/react-query";
import type { Investigation, InvestigationSession } from "@/types/investigation";

// Use ChatMessageData from the component
type Message = ChatMessageData;

export function Query() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showInvestigationSelector, setShowInvestigationSelector] = useState(false);
  const [selectedInvestigation, setSelectedInvestigation] = useState<Investigation | null>(null);
  const [selectedSession, setSelectedSession] = useState<InvestigationSession | null>(null);
  const [useAgentic, setUseAgentic] = useState(true); // Default to agentic mode
  const [currentStreamContent, setCurrentStreamContent] = useState("");
  
  // Investigation context for helping the AI
  const [investigationContext, setInvestigationContext] = useState("");
  const [showContextInput, setShowContextInput] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  
  // Chat state
  const [currentChatId, setCurrentChatId] = useState<number | null>(null);
  const [showChatList, setShowChatList] = useState(true);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSubmittingRef = useRef(false);
  const { sessionId, setSession, clearSession } = useSessionStore();

  // Handle URL query parameter (from Timeline "Ask AI" button)
  useEffect(() => {
    const queryFromUrl = searchParams.get("q");
    if (queryFromUrl) {
      setInput(queryFromUrl);
      // Clear the URL parameter to avoid re-setting on navigation
      setSearchParams({}, { replace: true });
      // Focus the input
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [searchParams, setSearchParams]);

  // Agent progress tracking for streaming
  const { steps: agentSteps, startTime: agentStartTime, reset: resetAgentProgress } = useAgentProgress(
    currentStreamContent,
    isStreaming
  );

  // Keyboard shortcut: Ctrl+K to focus query input
  useFocusShortcut(textareaRef);
  const { currentInvestigation, investigations, setInvestigations } = useInvestigationStore();

  // Fetch all investigations
  const { data: investigationsData } = useQuery({
    queryKey: ["investigations"],
    queryFn: listInvestigations,
    staleTime: 30000,
  });

  // Fetch selected investigation details (with sessions)
  const { data: investigationDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ["investigation", selectedInvestigation?.id],
    queryFn: () => selectedInvestigation ? getInvestigation(selectedInvestigation.id) : null,
    enabled: !!selectedInvestigation,
  });

  // Sync investigations to store
  useEffect(() => {
    if (investigationsData?.investigations) {
      setInvestigations(investigationsData.investigations);
    }
  }, [investigationsData, setInvestigations]);

  // Set default investigation to current one and sync when it changes
  useEffect(() => {
    if (currentInvestigation) {
      setSelectedInvestigation(currentInvestigation);
    }
  }, [currentInvestigation]);

  // Reset selected session when investigation changes
  useEffect(() => {
    setSelectedSession(null);
    setCurrentChatId(null);
    setMessages([]);
    // Also clear the global session store to avoid using stale session from different investigation
    clearSession();
  }, [currentInvestigation?.id, clearSession]);

  // Auto-select first ready session when investigation details load
  useEffect(() => {
    if (investigationDetail?.sessions && !selectedSession) {
      const readySession = investigationDetail.sessions.find(s => s.status === "ready" || s.status === "searchable");
      if (readySession) {
        setSelectedSession(readySession);
        setSession(readySession.session_id);
      }
    }
  }, [investigationDetail?.sessions, selectedSession, setSession]);

  // Determine effective session ID (either from selected session or from store)
  const effectiveSessionId = selectedSession?.session_id || sessionId;

  // Fetch chats for current session
  const { data: chatsData, refetch: refetchChats } = useQuery({
    queryKey: ["chats", effectiveSessionId],
    queryFn: () => effectiveSessionId ? listChats(effectiveSessionId) : null,
    enabled: !!effectiveSessionId,
    staleTime: 10000,
  });

  // Load chat messages when a chat is selected (but not during active submission)
  useEffect(() => {
    if (currentChatId && !isSubmittingRef.current) {
      getChat(currentChatId).then((chat) => {
        setMessages(
          chat.messages.map((msg) => ({
            id: msg.id.toString(),
            role: msg.role as "user" | "assistant",
            content: msg.content,
            timestamp: new Date(msg.created_at),
            sources: msg.sources?.map((s) => ({ file: s })),
          }))
        );
      }).catch(console.error);
    }
  }, [currentChatId]);

  // Create new chat
  const handleNewChat = async () => {
    if (!effectiveSessionId) return;
    try {
      const chat = await createChat(effectiveSessionId);
      setCurrentChatId(chat.id);
      setMessages([]);
      refetchChats();
    } catch (error) {
      console.error("Failed to create chat:", error);
    }
  };

  // Select existing chat
  const handleSelectChat = (chatId: number) => {
    setCurrentChatId(chatId);
  };

  // Delete chat
  const handleDeleteChat = async (chatId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteChat(chatId);
      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setMessages([]);
      }
      refetchChats();
    } catch (error) {
      console.error("Failed to delete chat:", error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !effectiveSessionId || isStreaming) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    // Save to query history
    addToQueryHistory(input, effectiveSessionId);

    setMessages((prev) => [...prev, userMessage]);
    const userInput = input;
    setInput("");
    setIsStreaming(true);
    setCurrentStreamContent(""); // Reset stream tracking
    resetAgentProgress(); // Reset agent progress
    isSubmittingRef.current = true;

    // Create chat if needed
    let chatId = currentChatId;
    if (!chatId) {
      try {
        const chat = await createChat(effectiveSessionId);
        chatId = chat.id;
        setCurrentChatId(chat.id);
        refetchChats();
      } catch (error) {
        console.error("Failed to create chat:", error);
      }
    }

    // Save user message to chat
    if (chatId) {
      try {
        await addChatMessage(chatId, "user", userInput);
      } catch (error) {
        console.error("Failed to save user message:", error);
      }
    }

    // Add placeholder for assistant message
    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", timestamp: new Date(), isAgentic: useAgentic },
    ]);

    let fullResponse = "";
    
    try {
      // Build conversation history from previous messages (exclude system/action messages)
      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .filter((m) => m.content && !m.content.startsWith("Generating "))
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      
      // Choose query method based on mode
      const queryFn = useAgentic ? queryAgenticAnalysis : queryAnalysis;
      
      await queryFn(effectiveSessionId, userInput, (token) => {
        fullResponse += token;
        // Track streaming content for agent progress
        setCurrentStreamContent(prev => prev + token);
        
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: msg.content + token }
              : msg
          )
        );
      }, history, investigationContext || undefined);
      
      // Ensure the final accumulated content is committed
      // (guards against batching edge cases where incremental updates
      //  haven't flushed to state before setIsStreaming(false) runs)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: fullResponse }
            : msg
        )
      );
      
      // Save assistant response to chat
      if (chatId && fullResponse) {
        try {
          await addChatMessage(chatId, "assistant", fullResponse);
        } catch (error) {
          console.error("Failed to save assistant message:", error);
        }
      }
    } catch (error) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: `Error: ${(error as Error).message}` }
            : msg
        )
      );
    } finally {
      setIsStreaming(false);
      setCurrentStreamContent("");
      isSubmittingRef.current = false;
    }
  };

  const handleQuickAction = async (action: "summary" | "anomalies" | "iocs") => {
    if (!effectiveSessionId || isStreaming) return;

    setIsStreaming(true);
    const actionId = Date.now().toString();

    setMessages((prev) => [
      ...prev,
      {
        id: actionId,
        role: "assistant",
        content: `Generating ${action === "iocs" ? "IOC extraction" : action}...`,
        timestamp: new Date(),
      },
    ]);

    try {
      let content = "";
      
      if (action === "summary") {
        const result = await getSummary(effectiveSessionId);
        content = result.summary;
      } else if (action === "anomalies") {
        const result = await getAnomalies(effectiveSessionId);
        content = `## Anomalies Detected: ${result.total_count}\n\n`;
        content += `High Severity: ${result.high_severity_count}\n\n`;
        result.anomalies.forEach((a: { type: string; severity: string; description: string; score: number }) => {
          content += `### ${a.type}\n- Severity: ${a.severity}\n- Score: ${a.score}\n- ${a.description}\n\n`;
        });
      } else if (action === "iocs") {
        const result = await extractIOCs(effectiveSessionId);
        content = `## Indicators of Compromise (IOCs)\n\n`;
        content += `**Total IOCs Found:** ${result.total_count}\n\n`;
        
        // IP Addresses
        if (result.iocs.ip_addresses.length > 0) {
          content += `### IP Addresses (${result.iocs.ip_addresses.length})\n`;
          result.iocs.ip_addresses.forEach((ioc) => {
            content += `- \`${ioc.value}\` (${ioc.type || "unknown"})\n`;
          });
          content += "\n";
        }
        
        // URLs
        if (result.iocs.urls.length > 0) {
          content += `### URLs (${result.iocs.urls.length})\n`;
          result.iocs.urls.forEach((ioc) => {
            content += `- \`${ioc.value}\`\n`;
          });
          content += "\n";
        }
        
        // Domains
        if (result.iocs.domains.length > 0) {
          content += `### Domains (${result.iocs.domains.length})\n`;
          result.iocs.domains.forEach((ioc) => {
            content += `- \`${ioc.value}\`\n`;
          });
          content += "\n";
        }
        
        // File Hashes
        if (result.iocs.file_hashes.length > 0) {
          content += `### File Hashes (${result.iocs.file_hashes.length})\n`;
          result.iocs.file_hashes.forEach((ioc) => {
            content += `- \`${ioc.value}\` (${ioc.type?.toUpperCase() || "hash"})\n`;
          });
          content += "\n";
        }
        
        // Suspicious Paths
        if (result.iocs.file_paths.length > 0) {
          content += `### Suspicious File Paths (${result.iocs.file_paths.length})\n`;
          result.iocs.file_paths.forEach((ioc) => {
            content += `- \`${ioc.value}\`\n`;
          });
          content += "\n";
        }
        
        // Emails
        if (result.iocs.email_addresses.length > 0) {
          content += `### Email Addresses (${result.iocs.email_addresses.length})\n`;
          result.iocs.email_addresses.forEach((ioc) => {
            content += `- \`${ioc.value}\`\n`;
          });
          content += "\n";
        }
        
        // LLM Analysis
        if (result.llm_analysis) {
          content += `### AI Analysis\n${result.llm_analysis}\n`;
        }
      }

      setMessages((prev) =>
        prev.map((msg) => (msg.id === actionId ? { ...msg, content } : msg))
      );
    } catch (error) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === actionId
            ? { ...msg, content: `Error: ${(error as Error).message}` }
            : msg
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  // Handle session selection
  const handleSelectSession = (session: InvestigationSession) => {
    setSelectedSession(session);
    setSession(session.session_id);
    setShowInvestigationSelector(false);
    // Clear messages and reset chat when switching sessions
    setMessages([]);
    setCurrentChatId(null);
  };

  if (!effectiveSessionId) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-12 h-12 mx-auto bg-brand-primary/10 rounded-xl flex items-center justify-center mb-4">
            <Sparkles className="w-6 h-6 text-brand-primary" />
          </div>
          <h2 className="font-heading font-semibold text-xl mb-1">
            AI Analysis
          </h2>
          <p className="text-text-secondary text-sm mb-6">
            Ask questions about your forensic data using AI-powered analysis.
          </p>

          {/* Investigation Selector */}
          <div className="bg-bg-surface border border-border-subtle rounded-xl p-5 text-left space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-text-muted mb-2">
                1. Select Investigation
              </label>
              <div className="relative">
                <button
                  onClick={() => setShowInvestigationSelector(!showInvestigationSelector)}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-bg-elevated border border-border-default rounded-lg hover:border-brand-primary/50 transition-colors text-left"
                >
                  {selectedInvestigation ? (
                    <div className="flex items-center gap-2.5">
                      <FolderOpen className="w-4 h-4 text-brand-primary" />
                      <div>
                        <p className="text-sm font-medium text-text-primary">{selectedInvestigation.name}</p>
                        <p className="text-[10px] text-text-muted">
                          {selectedInvestigation.session_count} session{selectedInvestigation.session_count !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-text-muted">Select an investigation...</span>
                  )}
                  <ChevronDown className={cn("w-4 h-4 text-text-muted transition-transform", showInvestigationSelector && "rotate-180")} />
                </button>

                {showInvestigationSelector && (
                  <div className="absolute z-10 w-full mt-1 bg-bg-surface border border-border-default rounded-lg shadow-xl max-h-56 overflow-y-auto">
                    {investigations.length === 0 ? (
                      <div className="p-3 text-center text-sm text-text-muted">
                        No investigations found
                      </div>
                    ) : (
                      investigations.filter(inv => inv.status === "active").map((inv) => (
                        <button
                          key={inv.id}
                          onClick={() => {
                            setSelectedInvestigation(inv);
                            setSelectedSession(null);
                            setShowInvestigationSelector(false);
                          }}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-bg-hover text-left text-sm",
                            selectedInvestigation?.id === inv.id && "bg-brand-primary/10"
                          )}
                        >
                          <FolderOpen className="w-4 h-4 text-brand-primary" />
                          <div>
                            <p className="font-medium text-text-primary">{inv.name}</p>
                            <p className="text-[10px] text-text-muted">
                              {inv.session_count} session{inv.session_count !== 1 ? "s" : ""} · {inv.case_number || "No case number"}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Sessions List */}
            {selectedInvestigation && (
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-text-muted mb-2">
                  2. Select Session
                </label>
                {loadingDetail ? (
                  <div className="flex items-center justify-center gap-2 p-4 text-text-muted text-sm">
                    <Spinner className="w-4 h-4" /> Loading sessions...
                  </div>
                ) : investigationDetail?.sessions && investigationDetail.sessions.length > 0 ? (
                  <div className="space-y-1.5">
                    {investigationDetail.sessions.map((session) => (
                      <button
                        key={session.id}
                        onClick={() => handleSelectSession(session)}
                        className={cn(
                          "w-full flex items-center gap-2.5 p-3 border rounded-lg text-left transition-colors text-sm",
                          session.status === "ready"
                            ? "border-border-default hover:border-brand-primary/50 hover:bg-brand-primary/5"
                            : "border-border-subtle opacity-50 cursor-not-allowed",
                          selectedSession?.id === session.id && "border-brand-primary bg-brand-primary/5"
                        )}
                        disabled={session.status !== "ready"}
                      >
                        <Database className={cn("w-4 h-4", session.status === "ready" ? "text-brand-primary" : "text-text-muted")} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-text-primary truncate text-sm">
                            {session.original_filename}
                          </p>
                          <p className="text-[10px] text-text-muted">
                            {session.total_artifacts} artifacts · {session.hostname || "Unknown host"} · {session.os_type || "Unknown OS"}
                          </p>
                        </div>
                        {session.status !== "ready" && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded font-medium">
                            {session.status}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 text-center text-sm text-text-muted border border-border-default rounded-lg">
                    No sessions in this investigation. Upload a file from the Dashboard.
                  </div>
                )}
              </div>
            )}

            {/* Or go to Dashboard */}
            <div className="text-center pt-3 border-t border-border-subtle">
              <p className="text-xs text-text-muted mb-2">
                Don't have any data yet?
              </p>
              <button
                onClick={() => (window.location.href = "/")}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-elevated border border-border-default rounded-lg hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                Go to Dashboard to Upload
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Sidebar - Chat History */}
      <div className={cn(
        "transition-all duration-300 flex-shrink-0 border-r border-border-subtle bg-bg-elevated overflow-hidden",
        showChatList ? "w-52" : "w-0"
      )}>
        <div className="w-52 h-full flex flex-col">
          <div className="p-2 border-b border-border-subtle flex-shrink-0">
            <button
              onClick={handleNewChat}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-brand-primary/10 text-brand-primary rounded-lg hover:bg-brand-primary/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Chat
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 min-h-0">
            {chatsData?.chats.map((chat: ChatSummary) => (
              <button
                key={chat.id}
                onClick={() => handleSelectChat(chat.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors group",
                  currentChatId === chat.id 
                    ? "bg-brand-primary/10 text-text-primary border border-brand-primary/20" 
                    : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                )}
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate flex-1 text-left">{chat.title}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleDeleteChat(chat.id, e)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleDeleteChat(chat.id, e as unknown as React.MouseEvent); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-status-error transition-opacity cursor-pointer"
                  title="Delete chat"
                >
                  <Trash2 className="w-3 h-3" />
                </span>
              </button>
            ))}
            
            {chatsData?.chats.length === 0 && (
              <div className="text-center py-4">
                <MessageSquare className="w-5 h-5 mx-auto mb-1.5 text-text-muted/40" />
                <p className="text-[10px] text-text-muted">
                  No chats yet
                </p>
              </div>
            )}
          </div>
          
          {/* Investigation/Session selector at bottom */}
          <div className="p-1.5 border-t border-border-subtle flex-shrink-0">
            <button
              onClick={() => setShowInvestigationSelector(!showInvestigationSelector)}
              className="w-full flex items-center gap-2 p-2 rounded-lg bg-bg-surface border border-border-subtle hover:border-border-default transition-colors text-left text-[10px]"
            >
              <FolderOpen className="w-3 h-3 text-brand-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-text-primary truncate text-xs">
                  {selectedInvestigation?.name || "Select Investigation"}
                </p>
              </div>
              <ChevronDown className={cn("w-3 h-3 text-text-muted transition-transform", showInvestigationSelector && "rotate-180")} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top Bar */}
        <div className="h-11 border-b border-border-subtle flex items-center justify-between px-3 bg-bg-surface/80 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChatList(!showChatList)}
              className="p-1.5 rounded-lg hover:bg-bg-hover transition-colors text-text-muted hover:text-text-primary"
              title={showChatList ? "Hide sidebar" : "Show sidebar"}
            >
              {showChatList ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>
            
            <div className="h-5 w-px bg-border-subtle" />
            
            {/* Mode Toggle */}
            <div className="flex items-center bg-bg-elevated rounded-lg p-0.5 border border-border-subtle">
              <button
                onClick={() => setUseAgentic(false)}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                  !useAgentic 
                    ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm" 
                    : "text-text-muted hover:text-text-primary"
                )}
                title="Fast mode - single RAG query, quicker responses"
              >
                <Zap className="w-3 h-3" />
                Fast
              </button>
              <button
                onClick={() => setUseAgentic(true)}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                  useAgentic 
                    ? "bg-gradient-to-r from-brand-primary to-purple-500 text-white shadow-sm" 
                    : "text-text-muted hover:text-text-primary"
                )}
                title="Agent mode - multi-step investigation, thorough analysis"
              >
                <Bot className="w-3 h-3" />
                Agent
              </button>
            </div>
            
            <span className="text-[10px] text-text-muted hidden sm:block">
              {useAgentic ? "Multi-step investigation" : "Quick single query"}
            </span>
          </div>
          
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowContext(!showContext)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors text-xs",
                showContext 
                  ? "bg-brand-primary/10 text-brand-primary border border-brand-primary/20" 
                  : "hover:bg-bg-hover text-text-muted hover:text-text-primary border border-transparent"
              )}
              title={showContext ? "Hide context" : "Show context"}
            >
              {showContext ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Context</span>
            </button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 lg:px-6 min-h-0">
          <div className="max-w-3xl mx-auto py-3 space-y-3">
            {messages.length === 0 ? (
              <div className="space-y-3 py-3">
                {/* Welcome Message */}
                <div className="text-center">
                  <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-gradient-to-br from-brand-primary/20 to-purple-500/20 flex items-center justify-center border border-brand-primary/10">
                    <Sparkles className="w-5 h-5 text-brand-primary" />
                  </div>
                  <h2 className="text-sm font-semibold text-text-primary mb-0.5">
                    How can I help with your investigation?
                  </h2>
                  <p className="text-[11px] text-text-muted max-w-sm mx-auto">
                    Ask questions about your forensic data. {useAgentic ? "Agent mode investigates step-by-step." : "Fast mode provides quick answers."}
                  </p>
                </div>
                
                {/* Suggested Questions */}
                <SuggestedQuestions
                  sessionId={effectiveSessionId}
                  onSelectQuestion={(q) => setInput(q)}
                />
                
                {/* Query History */}
                <QueryHistory
                  sessionId={effectiveSessionId}
                  onSelectQuery={(q) => setInput(q)}
                />
              </div>
            ) : (
              <>
                {/* Agent Progress indicator during streaming */}
                {isStreaming && useAgentic && agentSteps.length > 0 && (
                  <AgentProgress
                    isActive={isStreaming}
                    steps={agentSteps}
                    startTime={agentStartTime}
                    compact
                  />
                )}
                
                {/* Messages */}
                {messages.map((message, index) => (
                  <ChatMessage 
                    key={message.id} 
                    message={message} 
                    isStreaming={isStreaming && index === messages.length - 1 && message.role === "assistant"}
                    showSources={true}
                  />
                ))}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area - Floating at bottom */}
        <div className="border-t border-border-subtle bg-bg-surface/80 backdrop-blur-sm p-2.5 flex-shrink-0">
          <div className="max-w-3xl mx-auto">
            {/* Actions and Context Row */}
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px]">
              {/* Actions Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowActionsMenu(!showActionsMenu)}
                  disabled={isStreaming}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-elevated text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
                >
                  <Wand2 className="w-3 h-3" />
                  <span>Actions</span>
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
                {showActionsMenu && (
                  <div className="absolute bottom-full left-0 mb-1 bg-bg-surface border border-border-subtle rounded-lg shadow-xl py-0.5 min-w-[150px] z-10">
                    <button
                      onClick={() => { handleQuickAction("summary"); setShowActionsMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-left"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Generate Summary
                    </button>
                    <button
                      onClick={() => { handleQuickAction("anomalies"); setShowActionsMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-left"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Detect Anomalies
                    </button>
                    <button
                      onClick={() => { handleQuickAction("iocs"); setShowActionsMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-left"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      Extract IOCs
                    </button>
                  </div>
                )}
              </div>

              {/* Investigation Context Toggle */}
              <button
                onClick={() => setShowContextInput(true)}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors",
                  investigationContext 
                    ? "bg-brand-primary/10 text-brand-primary" 
                    : "bg-bg-elevated text-text-muted hover:text-text-primary"
                )}
              >
                <Info className="w-3 h-3" />
                <span>{investigationContext ? "Context provided" : "Add context"}</span>
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about your forensic data..."
                  className="resize-none min-h-[44px] max-h-28 pr-24 rounded-lg border-border-default focus:border-brand-primary text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  rows={1}
                />
                <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">
                  <span className="text-[10px] text-text-muted hidden sm:flex items-center gap-0.5">
                    <Keyboard className="w-2.5 h-2.5" />
                    Enter
                  </span>
                  <button
                    type="submit"
                    disabled={!input.trim() || isStreaming}
                    className="p-1.5 rounded-md bg-brand-primary text-white hover:bg-brand-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isStreaming ? <Spinner className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
        
        {/* Context Input Modal */}
        {showContextInput && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowContextInput(false)}>
            <div className="bg-bg-surface rounded-xl p-5 max-w-lg w-full mx-4 shadow-2xl border border-border-subtle" onClick={e => e.stopPropagation()}>
              <h3 className="font-semibold text-text-primary text-sm mb-1">Investigation Context</h3>
              <p className="text-xs text-text-muted mb-3">Provide background information to help the AI understand the incident better.</p>
              <textarea
                value={investigationContext}
                onChange={(e) => setInvestigationContext(e.target.value)}
                placeholder="Example: This is a compromised Linux web server. The attacker gained initial access via SSH brute force around 2024-01-15. We suspect data exfiltration and possible lateral movement."
                className="w-full h-28 px-3 py-2 text-sm bg-bg-elevated border border-border-subtle rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-brand-primary/50 placeholder:text-text-muted"
              />
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => setShowContextInput(false)} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors">Cancel</button>
                <button onClick={() => setShowContextInput(false)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors">
                  <Check className="w-3 h-3" />
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Investigation Selector Modal */}
        {showInvestigationSelector && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowInvestigationSelector(false)}>
            <div className="bg-bg-surface rounded-xl max-w-md w-full mx-4 shadow-2xl border border-border-subtle max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-3 border-b border-border-subtle">
                <h3 className="font-semibold text-text-primary text-sm">Select Data Source</h3>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="p-1.5">
                  <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider px-2 py-1">Investigations</p>
                  {investigations.filter(inv => inv.status === "active").map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => {
                        setSelectedInvestigation(inv);
                        setSelectedSession(null);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-bg-hover text-left text-xs",
                        selectedInvestigation?.id === inv.id && "bg-brand-primary/10"
                      )}
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-brand-primary shrink-0" />
                      <span className="truncate">{inv.name}</span>
                      {selectedInvestigation?.id === inv.id && <Check className="w-3.5 h-3.5 text-brand-primary ml-auto" />}
                    </button>
                  ))}
                </div>
                
                {selectedInvestigation && investigationDetail?.sessions && (
                  <div className="p-1.5 border-t border-border-subtle">
                    <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider px-2 py-1">Sessions</p>
                    {investigationDetail.sessions.map((session) => (
                      <button
                        key={session.id}
                        onClick={() => {
                          handleSelectSession(session);
                          setShowInvestigationSelector(false);
                        }}
                        disabled={session.status !== "ready"}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-bg-hover text-left text-xs",
                          selectedSession?.id === session.id && "bg-brand-primary/10",
                          session.status !== "ready" && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <Database className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        <div className="truncate flex-1">
                          <p className="truncate">{session.original_filename}</p>
                          <p className="text-[10px] text-text-muted">{session.total_artifacts} artifacts</p>
                        </div>
                        {selectedSession?.id === session.id && <Check className="w-3.5 h-3.5 text-brand-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-3 border-t border-border-subtle">
                <button onClick={() => setShowInvestigationSelector(false)} className="w-full py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Sidebar - Context Preview */}
      <div className={cn(
        "transition-all duration-300 flex-shrink-0 border-l border-border-subtle overflow-hidden",
        showContext ? "w-72" : "w-0"
      )}>
        <div className="w-72 h-full overflow-y-auto p-2.5 space-y-2.5">
          <SessionInfoPanel sessionId={effectiveSessionId} />
          <ContextPreview sessionId={effectiveSessionId} currentQuery={input} />
        </div>
      </div>
    </div>
  );
}

