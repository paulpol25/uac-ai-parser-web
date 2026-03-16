import * as React from "react"
import { cn } from "@/utils/cn"

export interface ShadcnInputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const ShadcnInput = React.forwardRef<HTMLInputElement, ShadcnInputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-text-primary ring-offset-bg-base file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50 focus-visible:ring-offset-2 focus-visible:border-brand-primary/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors",
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
ShadcnInput.displayName = "ShadcnInput"

export { ShadcnInput }
