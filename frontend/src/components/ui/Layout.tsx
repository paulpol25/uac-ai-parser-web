import { useState, useRef, useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Sparkles,
  Clock,
  Download,
  Settings,
  FolderOpen,
  LogOut,
  User,
  Search,
  ChevronDown,
  Menu,
  X,
  Crosshair,
  Monitor,
  ShieldAlert,
  BookOpen,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useQuery } from "@tanstack/react-query";
import { useInvestigationStore } from "@/stores/investigationStore";
import { useAuthStore, hasPermission } from "@/stores/authStore";
import { logout as apiLogout, listInvestigations, getCurrentUser } from "@/services/api";
import { Footer } from "./Footer";
import { ThemeToggle } from "./ThemeToggle";
import { GlobalUploadProgress } from "@/components/features/GlobalUploadProgress";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/investigations", icon: FolderOpen, label: "Cases" },
  { to: "/agents", icon: Monitor, label: "Agents", permission: "dispatch_commands" as const },
  { to: "/yara-rules", icon: ShieldAlert, label: "YARA Rules", permission: "manage_yara_rules" as const },
  { to: "/query", icon: Sparkles, label: "AI Query", permission: "query_data" as const },
  { to: "/timeline", icon: Clock, label: "Timeline" },
  { to: "/search", icon: Search, label: "Search" },
  { to: "/analysis", icon: Crosshair, label: "Analysis" },
  { to: "/export", icon: Download, label: "Export", permission: "export_data" as const },
  { to: "/docs", icon: BookOpen, label: "Documentation" },
  { to: "/settings", icon: Settings, label: "Settings", permission: "view_settings" as const },
];

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentInvestigation, setCurrentInvestigation, clearInvestigation } = useInvestigationStore();
  const { user, logout, isAuthenticated, setAuth } = useAuthStore();
  const [showInvestigationDropdown, setShowInvestigationDropdown] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const invDropdownRef = useRef<HTMLDivElement>(null);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  // Periodically refresh user data so permission/role changes reflect in the nav
  const { data: freshUser } = useQuery({
    queryKey: ["current-user"],
    queryFn: getCurrentUser,
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!freshUser) return;
    const token = useAuthStore.getState().token;
    if (token) setAuth(token, freshUser);
  }, [freshUser, setAuth]);

  // Filter nav items based on user permissions
  const visibleNavItems = navItems.filter((item) =>
    !item.permission || hasPermission(item.permission),
  );

  const { data: investigationsData } = useQuery({
    queryKey: ["investigations"],
    queryFn: listInvestigations,
    staleTime: 30000,
  });

  const investigations = investigationsData?.investigations?.filter(i => i.status === "active") || [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (invDropdownRef.current && !invDropdownRef.current.contains(e.target as Node)) {
        setShowInvestigationDropdown(false);
      }
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    try {
      await apiLogout();
    } catch {
      // Ignore errors
    }
    logout();
    clearInvestigation();
    navigate("/login");
  };

  const handleSelectInvestigation = (inv: typeof currentInvestigation) => {
    if (inv) {
      setCurrentInvestigation(inv);
    }
    setShowInvestigationDropdown(false);
  };

  return (
    <div className="h-screen flex flex-col bg-bg-base overflow-hidden">
      {/* Top Navigation Bar */}
      <header className="h-12 bg-bg-surface/90 backdrop-blur-xl border-b border-border-subtle flex items-center px-3 flex-shrink-0 z-40 relative">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-0.5 mr-3">
          <NavLink to="/" className="flex items-center gap-2 mr-3 group">
            <div className="w-7 h-7 bg-brand-primary/10 rounded-md flex items-center justify-center group-hover:bg-brand-primary/20 transition-colors border border-brand-primary/20">
              <img src="/uac.svg" alt="UAC" className="w-4 h-4" />
            </div>
            <span className="font-heading font-bold text-xs tracking-wider hidden sm:flex items-baseline gap-0.5">
              <span className="text-brand-primary">UAC</span>
              <span className="text-text-primary">AI</span>
              <span className="text-[9px] text-text-muted font-mono ml-1 hidden md:inline">PARSER</span>
            </span>
          </NavLink>

          {/* Separator */}
          <div className="h-5 w-px bg-border-subtle hidden lg:block mr-1" />

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center">
            {visibleNavItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all",
                    isActive
                      ? "bg-brand-primary/10 text-brand-primary"
                      : "text-text-muted hover:bg-bg-hover hover:text-text-primary"
                  )
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Right: Investigation + Theme + User */}
        <div className="ml-auto flex items-center gap-1.5">
          {/* Investigation Switcher */}
          <div ref={invDropdownRef} className="relative">
            <button
              onClick={() => setShowInvestigationDropdown(!showInvestigationDropdown)}
              className={cn(
                "flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md transition-all border",
                currentInvestigation
                  ? "bg-bg-elevated border-border-subtle hover:border-brand-primary/30"
                  : "bg-brand-primary/10 border-brand-primary/20 text-brand-primary hover:bg-brand-primary/15"
              )}
            >
              <FolderOpen className="w-3 h-3 text-brand-primary" />
              <span className="font-medium max-w-[120px] truncate hidden sm:block">
                {currentInvestigation?.name || "Select Case"}
              </span>
              <ChevronDown className="w-3 h-3 text-text-muted" />
            </button>

            {showInvestigationDropdown && (
              <div className="absolute right-0 top-full mt-1.5 z-50 bg-bg-surface border border-border-default rounded-lg shadow-lg min-w-[260px] max-h-[380px] overflow-hidden animate-fade-in">
                <div className="p-2 border-b border-border-subtle">
                  <p className="text-[10px] font-semibold text-text-muted px-2 py-0.5 uppercase tracking-wider">Active Cases</p>
                </div>
                <div className="overflow-y-auto max-h-[280px] p-1">
                  {investigations.length === 0 ? (
                    <p className="text-xs text-text-muted px-2 py-4 text-center">No cases available</p>
                  ) : (
                    investigations.map((inv) => (
                      <button
                        key={inv.id}
                        onClick={() => handleSelectInvestigation(inv)}
                        className={cn(
                          "w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left transition-all",
                          currentInvestigation?.id === inv.id
                            ? "bg-brand-primary/10 text-brand-primary"
                            : "hover:bg-bg-hover text-text-primary"
                        )}
                      >
                        <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-xs truncate">{inv.name}</p>
                          {inv.case_number && (
                            <p className="text-[10px] text-text-muted truncate font-mono">{inv.case_number}</p>
                          )}
                        </div>
                        {currentInvestigation?.id === inv.id && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-brand-primary/20 rounded font-semibold tracking-wider uppercase">Active</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
                <div className="p-1 border-t border-border-subtle">
                  <button
                    onClick={() => {
                      setShowInvestigationDropdown(false);
                      navigate("/investigations?create=true");
                    }}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs text-brand-primary hover:bg-brand-primary/10 rounded-md transition-colors font-medium"
                  >
                    + New Case
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Theme Toggle */}
          <ThemeToggle className="hidden sm:flex" />

          {/* User Profile */}
          {isAuthenticated && user && (
            <div ref={userDropdownRef} className="relative">
              <button
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-bg-hover transition-colors"
              >
                <div className="w-7 h-7 rounded-md bg-brand-primary flex items-center justify-center">
                  <User className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-[11px] font-medium text-text-secondary hidden md:block max-w-[80px] truncate">
                  {user.username}
                </span>
              </button>

              {showUserDropdown && (
                <div className="absolute right-0 top-full mt-1.5 z-50 bg-bg-surface border border-border-default rounded-lg shadow-lg min-w-[200px] animate-fade-in">
                  <div className="p-3 border-b border-border-subtle">
                    <p className="text-sm font-medium text-text-primary truncate">{user.username}</p>
                    <p className="text-[11px] text-text-muted truncate">{user.email}</p>
                  </div>
                  <div className="p-1">
                    <button
                      onClick={() => {
                        setShowUserDropdown(false);
                        navigate("/settings");
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover rounded-md transition-colors"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      Settings
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-error hover:bg-error/10 rounded-md transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="lg:hidden absolute inset-x-0 top-12 z-30 bg-bg-surface/95 backdrop-blur-xl border-b border-border-subtle animate-slide-up">
          <nav className="p-2 space-y-0.5">
            {visibleNavItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
                    isActive
                      ? "bg-brand-primary/10 text-brand-primary"
                      : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  )
                }
              >
                <Icon className="w-4 h-4" />
                {label}
              </NavLink>
            ))}
            <div className="pt-2 px-4">
              <ThemeToggle />
            </div>
          </nav>
        </div>
      )}

      {/* Page content */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </main>

      {/* Footer */}
      {location.pathname !== "/query" && (
        <div className="flex-shrink-0">
          <Footer />
        </div>
      )}

      <GlobalUploadProgress />
    </div>
  );
}
