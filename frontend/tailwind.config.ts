import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand colors
        brand: {
          primary: "#00D9FF",
          "primary-hover": "#33E1FF",
          "primary-muted": "rgba(0, 217, 255, 0.2)",
        },
        // Semantic colors
        success: "#10B981",
        warning: "#F59E0B",
        error: "#EF4444",
        info: "#6366F1",
        // Background colors (blue-tinted, not pure gray)
        bg: {
          base: "#0A0E14",
          surface: "#0F1419",
          elevated: "#1A1F26",
          hover: "#242B33",
        },
        // Border colors
        border: {
          subtle: "#1E2530",
          DEFAULT: "#2D3640",
          strong: "#3D4650",
        },
        // Text colors
        text: {
          primary: "#E6EDF3",
          secondary: "#8B949E",
          muted: "#6E7681",
          inverse: "#0A0E14",
        },
        // Anomaly score gradient
        anomaly: {
          low: "#10B981",
          medium: "#F59E0B",
          high: "#EF4444",
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
      },
      boxShadow: {
        sm: "0 1px 2px 0 rgb(0 0 0 / 0.3)",
        DEFAULT: "0 4px 6px -1px rgb(0 0 0 / 0.4), 0 2px 4px -2px rgb(0 0 0 / 0.3)",
        lg: "0 10px 15px -3px rgb(0 0 0 / 0.5), 0 4px 6px -4px rgb(0 0 0 / 0.4)",
        "glow-primary": "0 0 20px -5px #00D9FF",
        "glow-error": "0 0 20px -5px #EF4444",
        "glow-success": "0 0 20px -5px #10B981",
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
      },
    },
  },
  plugins: [],
} satisfies Config;
