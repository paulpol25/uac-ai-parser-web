import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AlertCircle, Shield, Eye, EyeOff, Lock } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { login, register, getAuthProviderType } from "@/services/api";
import { getSupabaseClient } from "@/services/supabase";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AuthProvider } from "@/types/auth";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { cn } from "@/utils/cn";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

// ------ Three.js Dot Matrix Background ------
function DotMatrix() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = 400;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const speeds = useMemo(
    () => Array.from({ length: count }, () => 0.2 + Math.random() * 0.6),
    []
  );
  const offsets = useMemo(
    () => Array.from({ length: count }, () => Math.random() * Math.PI * 2),
    []
  );

  useEffect(() => {
    if (!meshRef.current) return;
    const spacing = 2.2;
    const cols = Math.ceil(Math.sqrt(count));
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      dummy.position.set(
        (col - cols / 2) * spacing + (Math.random() - 0.5) * 0.4,
        (row - cols / 2) * spacing + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 2
      );
      dummy.scale.setScalar(0.08 + Math.random() * 0.06);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [count, dummy]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    for (let i = 0; i < count; i++) {
      meshRef.current.getMatrixAt(i, dummy.matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      const pulse = 0.5 + 0.5 * Math.sin(t * speeds[i] + offsets[i]);
      const baseScale = 0.08 + (i % 5) * 0.01;
      dummy.scale.setScalar(baseScale * (0.6 + pulse * 0.8));
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="#00D9FF" transparent opacity={0.15} />
    </instancedMesh>
  );
}

function CanvasBackground() {
  return (
    <div className="absolute inset-0 z-0">
      <Canvas
        camera={{ position: [0, 0, 20], fov: 50 }}
        style={{ background: "transparent" }}
        gl={{ antialias: false, alpha: true }}
      >
        <Suspense fallback={null}>
          <DotMatrix />
        </Suspense>
      </Canvas>
    </div>
  );
}

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

  const [showPassword, setShowPassword] = useState(false);

  const error = loginMutation.error || registerMutation.error;
  const isPending = loginMutation.isPending || registerMutation.isPending || supabaseLoading;
  const isSupabase = providerType === "supabase";

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-bg-base flex items-center justify-center">
      {/* Three.js Canvas Background */}
      <CanvasBackground />

      {/* Grid pattern underlay */}
      <div className="absolute inset-0 z-[1] forensic-grid opacity-30" />

      {/* Radial gradient overlay */}
      <div className="absolute inset-0 z-[2] bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--bg-base-alpha-70)_70%,var(--bg-base-alpha-95)_100%)]" />

      {/* Theme toggle in corner */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* Glassmorphic Login Card */}
      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-14 h-14 bg-brand-primary/10 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-brand-primary/20 shadow-lg shadow-brand-primary/10">
            <Shield className="w-7 h-7 text-brand-primary" />
          </div>
          <div className="text-center">
            <h1 className="font-heading font-bold text-2xl tracking-tight">
              <span className="text-brand-primary">UAC</span>{" "}
              <span className="text-text-primary">AI</span>
            </h1>
            <p className="text-text-muted text-[10px] tracking-[0.2em] uppercase font-mono mt-0.5">
              Forensic Analysis Platform
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="glass-card bg-bg-surface/70 border border-border-subtle/60 rounded-2xl p-8 shadow-2xl">
          <div className="mb-6">
            <h2 className="font-heading font-semibold text-xl text-text-primary">
              {isRegister ? "Create Account" : "Welcome Back"}
            </h2>
            <p className="text-text-muted text-sm mt-1">
              {isRegister
                ? "Set up your analyst credentials"
                : "Sign in to continue your investigation"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
                {isRegister ? "Username" : "Username or Email"}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 bg-bg-elevated/80 border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/50 transition-all"
                placeholder={isRegister ? "analyst_01" : "analyst_01 or analyst@org.com"}
                required
                autoComplete="username"
              />
            </div>

            {isRegister && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-bg-elevated/80 border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/50 transition-all"
                  placeholder="analyst@organization.com"
                  required
                  autoComplete="email"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-bg-elevated/80 border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/50 transition-all pr-10"
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {isRegister && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-bg-elevated/80 border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/50 transition-all"
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-error text-xs mt-1.5">Passwords do not match</p>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-error text-sm bg-error/10 px-4 py-2.5 rounded-lg border border-error/20">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{(error as Error).message}</span>
              </div>
            )}

            {supabaseError && (
              <div className="flex items-center gap-2 text-error text-sm bg-error/10 px-4 py-2.5 rounded-lg border border-error/20">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{supabaseError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isPending || (isRegister && password !== confirmPassword)}
              className={cn(
                "w-full py-2.5 rounded-lg text-sm font-semibold transition-all",
                "bg-brand-primary text-bg-base hover:bg-brand-primary-hover",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "shadow-lg shadow-brand-primary/20 hover:shadow-brand-primary/30"
              )}
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {isRegister ? "Creating account..." : "Signing in..."}
                </span>
              ) : isRegister ? "Create Account" : "Sign In"}
            </button>
          </form>

          {/* OAuth buttons (Supabase only) */}
          {isSupabase && (
            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border-subtle/60" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
                  <span className="bg-bg-surface/60 px-3 text-text-muted">Or continue with</span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleOAuthLogin("google")}
                  disabled={isPending}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-bg-elevated/60 border border-border-subtle rounded-lg text-text-primary text-xs font-medium hover:bg-bg-hover transition-colors disabled:opacity-50"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  Google
                </button>
                <button
                  type="button"
                  onClick={() => handleOAuthLogin("github")}
                  disabled={isPending}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-bg-elevated/60 border border-border-subtle rounded-lg text-text-primary text-xs font-medium hover:bg-bg-hover transition-colors disabled:opacity-50"
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
              className="text-xs text-text-muted hover:text-brand-primary transition-colors"
            >
              {isRegister
                ? "Already have an account? Sign in"
                : "Don't have an account? Create one"}
            </button>
          </div>
        </div>

        {/* Footer text */}
        <div className="flex items-center justify-center gap-2 mt-6">
          <Lock className="w-3 h-3 text-text-muted/50" />
          <p className="text-text-muted text-[10px] tracking-wide uppercase font-mono">
            Secure Forensic Analysis Platform
          </p>
        </div>
      </div>
    </div>
  );
}
