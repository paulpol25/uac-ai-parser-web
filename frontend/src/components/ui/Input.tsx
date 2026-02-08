import { clsx } from "clsx";
import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, error, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(
          "w-full bg-bg-base border rounded px-3 py-2 text-sm",
          "placeholder:text-text-muted",
          "focus:outline-none focus:border-brand-primary focus:shadow-glow-primary",
          "transition-all",
          error ? "border-error" : "border-border-default",
          className
        )}
        {...props}
      />
    );
  }
);

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, error, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={clsx(
          "w-full bg-bg-base border rounded px-3 py-2 text-sm resize-none",
          "placeholder:text-text-muted",
          "focus:outline-none focus:border-brand-primary focus:shadow-glow-primary",
          "transition-all",
          error ? "border-error" : "border-border-default",
          className
        )}
        {...props}
      />
    );
  }
);
