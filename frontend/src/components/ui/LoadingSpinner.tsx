/**
 * LoadingSpinner - Consistent loading states across the app
 */
import { Loader2 } from "lucide-react";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}

const sizeMap = {
  sm: "w-4 h-4",
  md: "w-6 h-6",
  lg: "w-10 h-10",
};

export function LoadingSpinner({ size = "md", label, className = "" }: LoadingSpinnerProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 ${className}`}>
      <Loader2 className={`${sizeMap[size]} animate-spin text-brand-primary`} />
      {label && <p className="text-sm text-text-muted">{label}</p>}
    </div>
  );
}

interface LoadingOverlayProps {
  label?: string;
}

export function LoadingOverlay({ label = "Loading..." }: LoadingOverlayProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bg-surface/80 backdrop-blur-sm z-10">
      <LoadingSpinner size="lg" label={label} />
    </div>
  );
}

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-gradient-to-r from-bg-elevated via-bg-hover to-bg-elevated bg-[length:200%_100%] animate-shimmer rounded ${className}`}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-4 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default LoadingSpinner;
