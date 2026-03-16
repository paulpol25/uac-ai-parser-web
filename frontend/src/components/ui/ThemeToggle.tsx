import { Moon, Sun } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { cn } from "@/utils/cn";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useThemeStore();

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        "relative flex items-center justify-center w-8 h-8 rounded-lg transition-colors",
        "hover:bg-bg-hover text-text-muted hover:text-text-primary",
        className
      )}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
    </button>
  );
}
