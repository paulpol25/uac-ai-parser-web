import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/utils/cn";

interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}

export function CustomSelect({ value, onChange, options, placeholder = "Select...", className }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("keydown", handleKey);
      return () => document.removeEventListener("keydown", handleKey);
    }
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center justify-between gap-2 px-2.5 py-1.5 bg-bg-base border border-border-default rounded-lg text-xs",
          "focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-colors",
          "hover:border-brand-primary/30 min-w-0 w-full text-left"
        )}
      >
        <span className="truncate text-text-primary">
          {selected?.label || placeholder}
        </span>
        <ChevronDown className={cn("w-3 h-3 text-text-muted flex-shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 w-full min-w-[200px] max-h-[240px] overflow-auto bg-bg-surface border border-border-subtle rounded-lg shadow-lg animate-fade-in">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-muted text-center">No options</p>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors",
                  option.value === value
                    ? "bg-brand-primary/10 text-brand-primary"
                    : "text-text-primary hover:bg-bg-hover"
                )}
              >
                <span className="flex-1 truncate">{option.label}</span>
                {option.value === value && <Check className="w-3 h-3 flex-shrink-0" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
