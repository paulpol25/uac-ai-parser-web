import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FileSearch, AlertCircle, Shield, Zap, Brain } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/authStore";
import { login, register } from "@/services/api";
import { useMutation } from "@tanstack/react-query";

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuth } = useAuthStore();
  const [isRegister, setIsRegister] = useState(false);
  
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const from = (location.state as { from?: string })?.from || "/";

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      setAuth(data.token, data.user);
      navigate(from, { replace: true });
    },
  });

  const registerMutation = useMutation({
    mutationFn: register,
    onSuccess: (data) => {
      setAuth(data.token, data.user);
      navigate(from, { replace: true });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isRegister) {
      if (password !== confirmPassword) {
        return;
      }
      registerMutation.mutate({ username, email, password });
    } else {
      loginMutation.mutate({ username, password });
    }
  };

  const error = loginMutation.error || registerMutation.error;
  const isPending = loginMutation.isPending || registerMutation.isPending;

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
