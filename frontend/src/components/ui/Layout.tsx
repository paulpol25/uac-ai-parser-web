import { useState } from "react";
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
  PanelLeftClose,
  PanelLeft,
  ChevronDown,
  Shield,
} from "lucide-react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { useInvestigationStore } from "@/stores/investigationStore";
import { useAuthStore } from "@/stores/authStore";
import { logout as apiLogout, listInvestigations } from "@/services/api";
import { Button } from "./Button";
import { Footer } from "./Footer";
import { GlobalUploadProgress } from "@/components/features/GlobalUploadProgress";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/investigations", icon: FolderOpen, label: "Investigations" },
  { to: "/query", icon: Sparkles, label: "AI Analysis" },
  { to: "/timeline", icon: Clock, label: "Timeline" },
  { to: "/search", icon: Search, label: "Search" },
  { to: "/analysis", icon: Shield, label: "Analysis" },
  { to: "/export", icon: Download, label: "Export" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentInvestigation, setCurrentInvestigation, clearInvestigation } = useInvestigationStore();
  const { user, logout, isAuthenticated } = useAuthStore();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showInvestigationDropdown, setShowInvestigationDropdown] = useState(false);

  const { data: investigationsData } = useQuery({
    queryKey: ["investigations"],
    queryFn: listInvestigations,
    staleTime: 30000,
  });

  const investigations = investigationsData?.investigations?.filter(i => i.status === "active") || [];

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
    <div className="h-screen flex bg-bg-base overflow-hidden">
      {/* Sidebar */}
      <aside className={clsx(
        "bg-bg-surface border-r border-border-subtle flex flex-col flex-shrink-0 h-full overflow-y-auto transition-all duration-300",
        sidebarCollapsed ? "w-16" : "w-60"
      )}>
        {/* Logo */}
        <div className={clsx(
          "h-16 flex items-center border-b border-border-subtle",
          sidebarCollapsed ? "justify-center" : "px-4 justify-between"
        )}>
          <div className="flex items-center">
            <div className="w-9 h-9 bg-brand-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-brand-primary" />
            </div>
            {!sidebarCollapsed && <span className="font-heading font-semibold ml-3">UAC AI</span>}
          </div>
          {!sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3">
          <ul className="space-y-1">
            {navItems.map(({ to, icon: Icon, label }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                      isActive
                        ? "bg-brand-primary/10 text-brand-primary shadow-sm"
                        : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
                      sidebarCollapsed && "justify-center px-2"
                    )
                  }
                  title={sidebarCollapsed ? label : undefined}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {!sidebarCollapsed && label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Expand button when collapsed */}
        {sidebarCollapsed && (
          <div className="p-3 border-t border-border-subtle">
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="w-full p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors flex items-center justify-center"
              title="Expand sidebar"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* User section */}
        {isAuthenticated && user && (
          <div className="p-3 border-t border-border-subtle">
            {sidebarCollapsed ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-primary to-info flex items-center justify-center">
                  <User className="w-4 h-4 text-text-inverse" />
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-error transition-colors"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 px-2 py-2 bg-bg-elevated rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-primary to-info flex items-center justify-center">
                    <User className="w-4 h-4 text-text-inverse" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {user.username}
                    </p>
                    <p className="text-xs text-text-muted truncate">{user.email}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2 justify-start text-text-secondary hover:text-error"
                  onClick={handleLogout}
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </Button>
              </>
            )}
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-bg-surface border-b border-border-subtle flex items-center justify-between px-6 flex-shrink-0">
          <h1 className="font-heading font-semibold text-lg text-text-primary">
            AI-Powered Forensic Analysis
          </h1>
          
          {/* Investigation Switcher */}
          <div className="relative">
            <button
              onClick={() => setShowInvestigationDropdown(!showInvestigationDropdown)}
              className={clsx(
                "flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg transition-colors",
                currentInvestigation 
                  ? "bg-bg-elevated hover:bg-bg-hover" 
                  : "bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20"
              )}
            >
              <FolderOpen className="w-4 h-4 text-brand-primary" />
              <span className="font-medium max-w-[200px] truncate">
                {currentInvestigation?.name || "Select Investigation"}
              </span>
              <ChevronDown className="w-4 h-4 text-text-muted" />
            </button>
            
            {showInvestigationDropdown && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowInvestigationDropdown(false)} 
                />
                <div className="absolute right-0 top-full mt-2 z-50 bg-bg-surface border border-border-default rounded-xl shadow-xl min-w-[280px] max-h-[400px] overflow-hidden">
                  <div className="p-2 border-b border-border-subtle">
                    <p className="text-xs font-medium text-text-muted px-2 py-1">Switch Investigation</p>
                  </div>
                  <div className="overflow-y-auto max-h-[300px] p-2">
                    {investigations.length === 0 ? (
                      <p className="text-sm text-text-muted px-2 py-4 text-center">No investigations yet</p>
                    ) : (
                      investigations.map((inv) => (
                        <button
                          key={inv.id}
                          onClick={() => handleSelectInvestigation(inv)}
                          className={clsx(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
                            currentInvestigation?.id === inv.id
                              ? "bg-brand-primary/10 text-brand-primary"
                              : "hover:bg-bg-hover text-text-primary"
                          )}
                        >
                          <FolderOpen className="w-4 h-4 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{inv.name}</p>
                            {inv.case_number && (
                              <p className="text-xs text-text-muted truncate">{inv.case_number}</p>
                            )}
                          </div>
                          {currentInvestigation?.id === inv.id && (
                            <span className="text-xs px-1.5 py-0.5 bg-brand-primary/20 rounded">Active</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="p-2 border-t border-border-subtle">
                    <button
                      onClick={() => {
                        setShowInvestigationDropdown(false);
                        navigate("/investigations?create=true");
                      }}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-brand-primary hover:bg-brand-primary/10 rounded-lg transition-colors"
                    >
                      <span>+ New Investigation</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 min-h-0">
          <Outlet />
        </div>

        {/* Footer - hidden on chat page */}
        {location.pathname !== "/query" && (
          <div className="flex-shrink-0">
            <Footer />
          </div>
        )}
      </main>

      {/* Global Upload Progress Indicator */}
      <GlobalUploadProgress />
    </div>
  );
}
