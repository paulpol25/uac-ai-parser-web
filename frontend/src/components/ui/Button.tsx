import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center font-medium rounded transition-all",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        // Variants
        {
          "bg-brand-primary text-text-inverse hover:bg-brand-primary-hover hover:shadow-glow-primary":
            variant === "primary",
          "bg-bg-elevated text-text-primary border border-border-default hover:bg-bg-hover":
            variant === "secondary",
          "bg-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary":
            variant === "ghost",
          "bg-error/10 text-error hover:bg-error/20": variant === "danger",
        },
        // Sizes
        {
          "text-xs px-2.5 py-1.5": size === "sm",
          "text-sm px-4 py-2": size === "md",
          "text-base px-6 py-3": size === "lg",
        },
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
