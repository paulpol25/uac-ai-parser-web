import { cn } from "@/utils/cn";

// Quantum Pulse Loader - a forensics-themed loading animation
export function QuantumPulseLoader({
  className,
  size = "md",
  text,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  text?: string;
}) {
  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-10 h-10",
    lg: "w-16 h-16",
  };
  const dotSizes = {
    sm: "w-1 h-1",
    md: "w-1.5 h-1.5",
    lg: "w-2 h-2",
  };

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className={cn("relative", sizeClasses[size])}>
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full border-2 border-brand-primary/20 animate-[qp-spin_3s_linear_infinite]" />
        {/* Inner pulse ring */}
        <div className="absolute inset-1 rounded-full border border-brand-primary/40 animate-[qp-pulse_2s_ease-in-out_infinite]" />
        {/* Core dot */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className={cn("rounded-full bg-brand-primary shadow-[0_0_8px_rgba(0,217,255,0.6)] animate-[qp-core_1.5s_ease-in-out_infinite]", dotSizes[size])} />
        </div>
        {/* Orbiting dots */}
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="absolute inset-0 animate-[qp-spin_2s_linear_infinite]"
            style={{ animationDelay: `${i * -0.66}s` }}
          >
            <div
              className={cn("absolute top-0 left-1/2 -translate-x-1/2 rounded-full bg-brand-primary/70", dotSizes[size])}
            />
          </div>
        ))}
      </div>
      {text && (
        <span className="text-xs text-text-muted font-mono animate-pulse">
          {text}
        </span>
      )}
    </div>
  );
}

// Simple inline spinner for buttons and small contexts
export function Spinner({
  className,
  size = 16,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={cn("animate-spin text-current", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// Skeleton bar loader for content areas
export function BarLoader({ className }: { className?: string }) {
  return (
    <div className={cn("w-full h-1 bg-bg-elevated rounded-full overflow-hidden", className)}>
      <div className="h-full bg-brand-primary/60 rounded-full animate-[qp-bar_1.5s_ease-in-out_infinite]" />
    </div>
  );
}

// Full-page loading state
export function PageLoader({ text = "Loading..." }: { text?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <QuantumPulseLoader size="lg" text={text} />
    </div>
  );
}
