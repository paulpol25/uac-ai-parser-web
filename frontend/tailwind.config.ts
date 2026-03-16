import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "var(--brand-primary)",
          "primary-hover": "var(--brand-primary-hover)",
          "primary-muted": "var(--brand-primary-muted)",
        },
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        error: "var(--color-error)",
        info: "var(--color-info)",
        bg: {
          base: "var(--bg-base)",
          surface: "var(--bg-surface)",
          elevated: "var(--bg-elevated)",
          hover: "var(--bg-hover)",
        },
        border: {
          subtle: "var(--border-subtle)",
          DEFAULT: "var(--border-default)",
          default: "var(--border-default)",
          strong: "var(--border-strong)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          inverse: "var(--text-inverse)",
        },
        anomaly: {
          low: "#10B981",
          medium: "#F59E0B",
          high: "#EF4444",
          critical: "#DC2626",
        },
        forensic: {
          green: "var(--forensic-green)",
          amber: "var(--forensic-amber)",
          red: "var(--forensic-red)",
          blue: "var(--forensic-blue)",
          purple: "var(--forensic-purple)",
        },
      },
      fontFamily: {
        heading: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      fontSize: {
        xs: "0.75rem",
        sm: "0.875rem",
        base: "1rem",
        lg: "1.125rem",
        xl: "1.333rem",
        "2xl": "1.777rem",
        "3xl": "2.369rem",
      },
      spacing: {
        "18": "4.5rem",
        "22": "5.5rem",
      },
      borderRadius: {
        sm: "0.25rem",
        DEFAULT: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        "glow-primary": "0 0 20px -5px var(--brand-primary)",
        "glow-error": "0 0 20px -5px var(--color-error)",
        "glow-success": "0 0 20px -5px var(--color-success)",
        "glow-forensic": "0 0 30px -8px var(--forensic-green)",
      },
      transitionTimingFunction: {
        snappy: "cubic-bezier(0.25, 1, 0.5, 1)",
      },
      animation: {
        "fade-in": "fadeIn 200ms ease-out",
        "slide-up": "slideUp 200ms ease-out",
        "slide-in-right": "slideInRight 200ms ease-out",
        "slide-in-left": "slideInLeft 200ms ease-out",
        pulse: "pulse 2s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
        "bounce-subtle": "bounceSubtle 1s ease-in-out infinite",
        "scan-line": "scanLine 3s linear infinite",
        "border-beam": "borderBeam 4s linear infinite",
        "grid-fade": "gridFade 3s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { transform: "translateY(8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        slideInRight: {
          from: { transform: "translateX(8px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        slideInLeft: {
          from: { transform: "translateX(-8px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        bounceSubtle: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-2px)" },
        },
        scanLine: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        borderBeam: {
          "0%": { offsetDistance: "0%" },
          "100%": { offsetDistance: "100%" },
        },
        gridFade: {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "0.6" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
