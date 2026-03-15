import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, Sparkles, AlertTriangle, FileText, PanelRightOpen, PanelRightClose, PanelLeftOpen, PanelLeftClose, FolderOpen, Database, ChevronDown, Shield, Keyboard, Bot, Zap, Plus, MessageSquare, Trash2, Info, Check, Wand2 } from "lucide-react";
import { useFocusShortcut } from "@/hooks/useKeyboardShortcuts";
import { Button } from "@/components/ui/Button";
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

  // Load chat messages when a chat is selected
  useEffect(() => {
    if (currentChatId) {
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
      <div className="h-full flex flex-col items-center justify-center p-8">
        <div className="max-w-lg w-full text-center">
          <div className="w-16 h-16 mx-auto bg-brand-primary/10 rounded-2xl flex items-center justify-center mb-6">
            <Sparkles className="w-8 h-8 text-brand-primary" />
          </div>
          <h2 className="font-heading font-semibold text-2xl mb-2">
            AI Analysis
          </h2>
          <p className="text-text-secondary mb-8">
            Ask questions about your forensic data using AI-powered analysis.
          </p>
        

          {/* Investigation Selector */}
          <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 text-left space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                1. Select Investigation
              </label>
              <div className="relative">
                <button
                  onClick={() => setShowInvestigationSelector(!showInvestigationSelector)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-bg-base border border-border-default rounded-lg hover:border-brand-primary transition-colors text-left"
                >
                  {selectedInvestigation ? (
                    <div className="flex items-center gap-3">
                      <FolderOpen className="w-5 h-5 text-brand-primary" />
                      <div>
                        <p className="font-medium text-text-primary">{selectedInvestigation.name}</p>
                        <p className="text-xs text-text-muted">
                          {selectedInvestigation.session_count} session{selectedInvestigation.session_count !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <span className="text-text-muted">Select an investigation...</span>
                  )}
                  <ChevronDown className={`w-5 h-5 text-text-muted transition-transform ${showInvestigationSelector ? "rotate-180" : ""}`} />
                </button>

                {showInvestigationSelector && (
                  <div className="absolute z-10 w-full mt-2 bg-bg-surface border border-border-default rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {investigations.length === 0 ? (
                      <div className="p-4 text-center text-text-muted">
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
                          className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover text-left ${
                            selectedInvestigation?.id === inv.id ? "bg-brand-primary/10" : ""
                          }`}
                        >
                          <FolderOpen className="w-5 h-5 text-brand-primary" />
                          <div>
                            <p className="font-medium text-text-primary">{inv.name}</p>
                            <p className="text-xs text-text-muted">
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
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  2. Select Session
                </label>
                {loadingDetail ? (
                  <div className="p-4 text-center text-text-muted">Loading sessions...</div>
                ) : investigationDetail?.sessions && investigationDetail.sessions.length > 0 ? (
                  <div className="space-y-2">
                    {investigationDetail.sessions.map((session) => (
                      <button
                        key={session.id}
                        onClick={() => handleSelectSession(session)}
                        className={`w-full flex items-center gap-3 p-4 border rounded-lg text-left transition-colors ${
                          session.status === "ready"
                            ? "border-border-default hover:border-brand-primary hover:bg-brand-primary/5"
                            : "border-border-subtle opacity-60 cursor-not-allowed"
                        } ${selectedSession?.id === session.id ? "border-brand-primary bg-brand-primary/5" : ""}`}
                        disabled={session.status !== "ready"}
                      >
                        <Database className={`w-5 h-5 ${session.status === "ready" ? "text-brand-primary" : "text-text-muted"}`} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-text-primary truncate">
                            {session.original_filename}
                          </p>
                          <p className="text-xs text-text-muted">
                            {session.total_artifacts} artifacts · {session.hostname || "Unknown host"} · {session.os_type || "Unknown OS"}
                          </p>
                        </div>
                        {session.status !== "ready" && (
                          <span className="text-xs px-2 py-1 bg-amber-500/10 text-amber-500 rounded">
                            {session.status}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-text-muted border border-border-default rounded-lg">
                    No sessions in this investigation. Upload a file from the Dashboard.
                  </div>
                )}
              </div>
            )}

            {/* Or go to Dashboard */}
            <div className="text-center pt-4 border-t border-border-subtle">
              <p className="text-sm text-text-muted mb-3">
                Don't have any data yet?
              </p>
              <Button variant="secondary" onClick={() => (window.location.href = "/")}>
                Go to Dashboard to Upload
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Sidebar - Chat History */}
      <div className={`${
        showChatList ? "w-56" : "w-0"
      } transition-all duration-300 flex-shrink-0 border-r border-border-subtle bg-bg-elevated overflow-hidden`}>
        <div className="w-56 h-full flex flex-col">
          <div className="p-3 border-b border-border-subtle flex-shrink-0">
            <Button
              onClick={handleNewChat}
              className="w-full justify-center"
              size="sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Chat
            </Button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
            {chatsData?.chats.map((chat: ChatSummary) => (
              <button
                key={chat.id}
                onClick={() => handleSelectChat(chat.id)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors group ${
                  currentChatId === chat.id 
                    ? "bg-brand-primary/10 text-text-primary border border-brand-primary/30" 
                    : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                }`}
              >
                <MessageSquare className="w-4 h-4 shrink-0" />
                <span className="truncate flex-1 text-left">{chat.title}</span>
                <button
                  onClick={(e) => handleDeleteChat(chat.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-status-error transition-opacity"
                  title="Delete chat"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </button>
            ))}
            
            {chatsData?.chats.length === 0 && (
              <div className="text-center py-6">
                <MessageSquare className="w-6 h-6 mx-auto mb-2 text-text-muted/50" />
                <p className="text-xs text-text-muted">
                  No chats yet
                </p>
              </div>
            )}
          </div>
          
          {/* Investigation/Session selector at bottom */}
          <div className="p-2 border-t border-border-subtle flex-shrink-0">
            <button
              onClick={() => setShowInvestigationSelector(!showInvestigationSelector)}
              className="w-full flex items-center gap-2 p-2 rounded-lg bg-bg-surface border border-border-subtle hover:border-border-default transition-colors text-left text-xs"
            >
              <FolderOpen className="w-3.5 h-3.5 text-brand-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-text-primary truncate">
                  {selectedInvestigation?.name || "Select Investigation"}
                </p>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${showInvestigationSelector ? "rotate-180" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top Bar */}
        <div className="h-12 border-b border-border-subtle flex items-center justify-between px-4 bg-bg-surface flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChatList(!showChatList)}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors text-text-muted hover:text-text-primary"
              title={showChatList ? "Hide sidebar" : "Show sidebar"}
            >
              {showChatList ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
            </button>
            
            <div className="h-6 w-px bg-border-subtle" />
            
            {/* Mode Toggle */}
            <div className="flex items-center bg-bg-elevated rounded-lg p-1 border border-border-subtle">
              <button
                onClick={() => setUseAgentic(false)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  !useAgentic 
                    ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm" 
                    : "text-text-muted hover:text-text-primary"
                }`}
                title="Fast mode - single RAG query, quicker responses"
              >
                <Zap className="w-3.5 h-3.5" />
                Fast
              </button>
              <button
                onClick={() => setUseAgentic(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  useAgentic 
                    ? "bg-gradient-to-r from-brand-primary to-purple-500 text-white shadow-sm" 
                    : "text-text-muted hover:text-text-primary"
                }`}
                title="Agent mode - multi-step investigation, thorough analysis"
              >
                <Bot className="w-3.5 h-3.5" />
                Agent
              </button>
            </div>
            
            <span className="text-xs text-text-muted hidden sm:block">
              {useAgentic ? "Multi-step investigation" : "Quick single query"}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowContext(!showContext)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm ${
                showContext 
                  ? "bg-brand-primary/10 text-brand-primary border border-brand-primary/30" 
                  : "hover:bg-bg-hover text-text-muted hover:text-text-primary border border-transparent"
              }`}
              title={showContext ? "Hide context" : "Show context"}
            >
              {showContext ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
              <span className="hidden sm:inline">Context</span>
            </button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 lg:px-6 min-h-0">
          <div className="max-w-3xl mx-auto py-4 space-y-4">
            {messages.length === 0 ? (
              <div className="space-y-4 py-4">
                {/* Welcome Message */}
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto mb-2 rounded-xl bg-gradient-to-br from-brand-primary/20 to-purple-500/20 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-brand-primary" />
                  </div>
                  <h2 className="text-base font-semibold text-text-primary mb-1">
                    How can I help with your investigation?
                  </h2>
                  <p className="text-xs text-text-muted max-w-md mx-auto">
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
        <div className="border-t border-border-subtle bg-bg-surface/80 backdrop-blur-sm p-3 flex-shrink-0">
          <div className="max-w-3xl mx-auto">
            {/* Actions and Context Row */}
            <div className="mb-2 flex items-center gap-2 text-xs">
              {/* Actions Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowActionsMenu(!showActionsMenu)}
                  disabled={isStreaming}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-bg-elevated text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
                >
                  <Wand2 className="w-3 h-3" />
                  <span>Actions</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                {showActionsMenu && (
                  <div className="absolute bottom-full left-0 mb-1 bg-bg-surface border border-border-subtle rounded-lg shadow-lg py-1 min-w-[160px] z-10">
                    <button
                      onClick={() => { handleQuickAction("summary"); setShowActionsMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-left"
                    >
                      <FileText className="w-4 h-4" />
                      Generate Summary
                    </button>
                    <button
                      onClick={() => { handleQuickAction("anomalies"); setShowActionsMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-left"
                    >
                      <AlertTriangle className="w-4 h-4" />
                      Detect Anomalies
                    </button>
                    <button
                      onClick={() => { handleQuickAction("iocs"); setShowActionsMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-left"
                    >
                      <Shield className="w-4 h-4" />
                      Extract IOCs
                    </button>
                  </div>
                )}
              </div>

              {/* Investigation Context Toggle */}
              <button
                onClick={() => setShowContextInput(true)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-full transition-colors ${
                  investigationContext 
                    ? "bg-brand-primary/10 text-brand-primary" 
                    : "bg-bg-elevated text-text-muted hover:text-text-primary"
                }`}
              >
                <Info className="w-3 h-3" />
                <span>{investigationContext ? "Context provided" : "Add context"}</span>
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="flex gap-3">
              <div className="relative flex-1">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about your forensic data..."
                  className="resize-none min-h-[52px] max-h-32 pr-24 rounded-xl border-border-default focus:border-brand-primary"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  rows={1}
                />
                <div className="absolute right-3 bottom-3 flex items-center gap-2">
                  <span className="text-xs text-text-muted hidden sm:flex items-center gap-1">
                    <Keyboard className="w-3 h-3" />
                    Enter
                  </span>
                  <Button 
                    type="submit" 
                    disabled={!input.trim() || isStreaming}
                    size="sm"
                    className="rounded-lg"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
        
        {/* Context Input Modal */}
        {showContextInput && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowContextInput(false)}>
            <div className="bg-bg-surface rounded-xl p-6 max-w-lg w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
              <h3 className="font-semibold text-text-primary mb-2">Investigation Context</h3>
              <p className="text-sm text-text-muted mb-4">Provide background information to help the AI understand the incident better.</p>
              <textarea
                value={investigationContext}
                onChange={(e) => setInvestigationContext(e.target.value)}
                placeholder="Example: This is a compromised Linux web server. The attacker gained initial access via SSH brute force around 2024-01-15. We suspect data exfiltration and possible lateral movement."
                className="w-full h-32 px-3 py-2 text-sm bg-bg-elevated border border-border-subtle rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-primary/50 placeholder:text-text-muted"
              />
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="ghost" onClick={() => setShowContextInput(false)}>Cancel</Button>
                <Button onClick={() => setShowContextInput(false)}>
                  <Check className="w-4 h-4 mr-2" />
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
        
        {/* Investigation Selector Modal */}
        {showInvestigationSelector && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowInvestigationSelector(false)}>
            <div className="bg-bg-surface rounded-xl max-w-md w-full mx-4 shadow-xl max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-border-subtle">
                <h3 className="font-semibold text-text-primary">Select Data Source</h3>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="p-2">
                  <p className="text-xs font-medium text-text-muted uppercase px-2 py-1">Investigations</p>
                  {investigations.filter(inv => inv.status === "active").map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => {
                        setSelectedInvestigation(inv);
                        setSelectedSession(null);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-hover text-left text-sm ${
                        selectedInvestigation?.id === inv.id ? "bg-brand-primary/10" : ""
                      }`}
                    >
                      <FolderOpen className="w-4 h-4 text-brand-primary shrink-0" />
                      <span className="truncate">{inv.name}</span>
                      {selectedInvestigation?.id === inv.id && <Check className="w-4 h-4 text-brand-primary ml-auto" />}
                    </button>
                  ))}
                </div>
                
                {selectedInvestigation && investigationDetail?.sessions && (
                  <div className="p-2 border-t border-border-subtle">
                    <p className="text-xs font-medium text-text-muted uppercase px-2 py-1">Sessions</p>
                    {investigationDetail.sessions.map((session) => (
                      <button
                        key={session.id}
                        onClick={() => {
                          handleSelectSession(session);
                          setShowInvestigationSelector(false);
                        }}
                        disabled={session.status !== "ready"}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-hover text-left text-sm ${
                          selectedSession?.id === session.id ? "bg-brand-primary/10" : ""
                        } ${session.status !== "ready" ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <Database className="w-4 h-4 text-text-muted shrink-0" />
                        <div className="truncate flex-1">
                          <p className="truncate">{session.original_filename}</p>
                          <p className="text-xs text-text-muted">{session.total_artifacts} artifacts</p>
                        </div>
                        {selectedSession?.id === session.id && <Check className="w-4 h-4 text-brand-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-4 border-t border-border-subtle">
                <Button variant="ghost" className="w-full" onClick={() => setShowInvestigationSelector(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Sidebar - Context Preview */}
      <div className={`${
        showContext ? "w-80" : "w-0"
      } transition-all duration-300 flex-shrink-0 border-l border-border-subtle overflow-hidden`}>
        <div className="w-80 h-full overflow-y-auto p-3 space-y-3">
          <SessionInfoPanel sessionId={effectiveSessionId} />
          <ContextPreview sessionId={effectiveSessionId} currentQuery={input} />
        </div>
      </div>
    </div>
  );
}

