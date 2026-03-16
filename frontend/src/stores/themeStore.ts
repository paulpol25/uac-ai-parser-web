import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      setTheme: (theme) => {
        document.documentElement.classList.remove("dark", "light");
        document.documentElement.classList.add(theme);
        set({ theme });
      },
      toggleTheme: () => {
        const next = get().theme === "dark" ? "light" : "dark";
        document.documentElement.classList.remove("dark", "light");
        document.documentElement.classList.add(next);
        set({ theme: next });
      },
    }),
    {
      name: "uac-theme",
      onRehydrateStorage: () => (state) => {
        if (state) {
          document.documentElement.classList.remove("dark", "light");
          document.documentElement.classList.add(state.theme);
        }
      },
    }
  )
);
