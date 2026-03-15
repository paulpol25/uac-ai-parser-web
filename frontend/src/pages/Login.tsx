import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FileSearch, AlertCircle, Shield, Zap, Brain } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/authStore";
import { login, register, getAuthProviderType } from "@/services/api";
import { getSupabaseClient } from "@/services/supabase";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AuthProvider } from "@/types/auth";

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuth, setAuthProvider } = useAuthStore();
  const [isRegister, setIsRegister] = useState(false);
  
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [supabaseLoading, setSupabaseLoading] = useState(false);

  const from = (location.state as { from?: string })?.from || "/";

  // Detect which auth provider the backend is using
  const { data: providerType } = useQuery<AuthProvider>({
    queryKey: ["authProvider"],
    queryFn: getAuthProviderType,
    staleTime: Infinity,
  });

  // Store the provider type when we detect it
  useEffect(() => {
    if (providerType) {
      setAuthProvider(providerType);
    }
  }, [providerType, setAuthProvider]);

  // Listen for Supabase auth state changes
  useEffect(() => {
    if (providerType !== "supabase") return;
    const client = getSupabaseClient();
    if (!client) return;

    const { data: { subscription } } = client.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.access_token) {
          // Sync to backend and get local user
          try {
            const res = await fetch("/api/v1/auth/me", {
              headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (res.ok) {
              const user = await res.json();
              setAuth(session.access_token, user);
              navigate(from, { replace: true });
            }
          } catch { /* ignore */ }
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [providerType, from, navigate, setAuth]);

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      if (data.token) {
        setAuth(data.token, data.user);
        navigate(from, { replace: true });
      }
    },
  });

  const registerMutation = useMutation({
    mutationFn: register,
    onSuccess: (data) => {
      if (data.token) {
        setAuth(data.token, data.user);
        navigate(from, { replace: true });
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSupabaseError(null);
    
    if (isRegister) {
      if (password !== confirmPassword) {
        return;
      }
      registerMutation.mutate({ username, email, password });
    } else {
      loginMutation.mutate({ username, password });
    }
  };

  const handleOAuthLogin = async (oauthProvider: "google" | "github") => {
    const client = getSupabaseClient();
    if (!client) return;

    setSupabaseLoading(true);
    setSupabaseError(null);
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: oauthProvider,
        options: { redirectTo: window.location.origin + from },
      });
      if (error) setSupabaseError(error.message);
    } catch (err) {
      setSupabaseError((err as Error).message);
    } finally {
      setSupabaseLoading(false);
    }
  };

  const error = loginMutation.error || registerMutation.error;
  const isPending = loginMutation.isPending || registerMutation.isPending || supabaseLoading;
  const isSupabase = providerType === "supabase";

  return (
    <div className="min-h-screen flex bg-bg-base">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:flex-1 flex-col justify-center px-12 bg-gradient-to-br from-bg-surface to-bg-base relative overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-0 left-0 w-full h-full" style={{
            backgroundImage: `radial-gradient(circle at 25% 25%, #00D9FF 1px, transparent 1px),
              radial-gradient(circle at 75% 75%, #6366F1 1px, transparent 1px)`,
            backgroundSize: '50px 50px'
          }} />
        </div>
        
        {/* Content */}
        <div className="relative z-10 max-w-lg">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3 bg-brand-primary/20 rounded-xl">
              <FileSearch className="w-10 h-10 text-brand-primary" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-3xl gradient-text">UAC AI Parser</h1>
              <p className="text-text-muted text-sm">AI-Powered Forensic Analysis</p>
            </div>
          </div>
          
          <h2 className="text-2xl font-heading font-semibold text-text-primary mb-4">
            Unix Artifact Collector Analysis Made Simple
          </h2>
          <p className="text-text-secondary mb-8 leading-relaxed">
            Leverage AI to analyze forensic data from UAC collections. Get intelligent insights, 
            detect anomalies, and speed up your incident response investigations.
          </p>
          
          {/* Features */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-success/10 rounded-lg mt-0.5">
                <Zap className="w-5 h-5 text-success" />
              </div>
              <div>
                <h3 className="font-medium text-text-primary">Fast Analysis</h3>
                <p className="text-sm text-text-muted">Parse and analyze UAC archives in minutes</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-2 bg-info/10 rounded-lg mt-0.5">
                <Brain className="w-5 h-5 text-info" />
              </div>
              <div>
                <h3 className="font-medium text-text-primary">AI-Powered Insights</h3>
                <p className="text-sm text-text-muted">Natural language queries with RAG technology</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-2 bg-warning/10 rounded-lg mt-0.5">
                <Shield className="w-5 h-5 text-warning" />
              </div>
              <div>
                <h3 className="font-medium text-text-primary">Anomaly Detection</h3>
                <p className="text-sm text-text-muted">Automatic identification of suspicious activity</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center justify-center gap-3 mb-8 lg:hidden">
            <FileSearch className="w-8 h-8 text-brand-primary" />
            <span className="font-heading font-bold text-2xl">UAC AI Parser</span>
          </div>

          <div className="bg-bg-surface border border-border-subtle rounded-xl p-8 shadow-lg">
            <div className="mb-6">
              <h2 className="font-heading font-semibold text-2xl text-text-primary">
                {isRegister ? "Create Account" : "Welcome Back"}
              </h2>
              <p className="text-text-secondary mt-1">
                {isRegister ? "Get started with UAC AI Parser" : "Sign in to continue your analysis"}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  {isRegister ? "Username" : "Username or Email"}
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3 bg-bg-elevated border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-colors"
                  placeholder={isRegister ? "johndoe" : "johndoe or john@example.com"}
                  required
                  autoComplete="username"
                />
              </div>

              {isRegister && (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-bg-elevated border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-colors"
                    placeholder="john@example.com"
                    required
                    autoComplete="email"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-bg-elevated border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-colors"
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                />
              </div>

              {isRegister && (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-bg-elevated border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-colors"
                    placeholder="••••••••"
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-error text-xs mt-2">Passwords do not match</p>
                  )}
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-error text-sm bg-error/10 px-4 py-3 rounded-lg">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{(error as Error).message}</span>
                </div>
              )}

              {supabaseError && (
                <div className="flex items-center gap-2 text-error text-sm bg-error/10 px-4 py-3 rounded-lg">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{supabaseError}</span>
                </div>
              )}

              <Button
                type="submit"
                className="w-full py-3"
                disabled={isPending || (isRegister && password !== confirmPassword)}
              >
                {isPending
                  ? isRegister
                    ? "Creating account..."
                    : "Signing in..."
                  : isRegister
                    ? "Create Account"
                    : "Sign In"}
              </Button>
            </form>

            {/* OAuth buttons (Supabase only) */}
            {isSupabase && (
              <div className="mt-6">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border-subtle" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-bg-surface px-2 text-text-muted">Or continue with</span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin("google")}
                    disabled={isPending}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-bg-elevated border border-border-default rounded-lg text-text-primary text-sm font-medium hover:bg-bg-base transition-colors disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    Google
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin("github")}
                    disabled={isPending}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-bg-elevated border border-border-default rounded-lg text-text-primary text-sm font-medium hover:bg-bg-base transition-colors disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>
                    GitHub
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsRegister(!isRegister);
                  setEmail("");
                  setConfirmPassword("");
                  loginMutation.reset();
                  registerMutation.reset();
                }}
                className="text-sm text-text-secondary hover:text-brand-primary transition-colors"
              >
                {isRegister
                  ? "Already have an account? Sign in"
                  : "Don't have an account? Create one"}
              </button>
            </div>
          </div>

          <p className="text-center text-text-muted text-xs mt-6">
            UAC AI Parser v1.0.0 • AI-Powered Forensic Analysis
          </p>
        </div>
      </div>
    </div>
  );
}
