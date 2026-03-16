import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/utils/cn"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:ring-offset-2 focus:ring-offset-bg-base",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-brand-primary text-bg-base hover:bg-brand-primary/80",
        secondary:
          "border-transparent bg-bg-elevated text-text-secondary hover:bg-bg-hover",
        destructive:
          "border-transparent bg-anomaly-critical text-white hover:bg-anomaly-critical/80",
        warning:
          "border-transparent bg-anomaly-high text-bg-base hover:bg-anomaly-high/80",
        success:
          "border-transparent bg-emerald-500 text-bg-base hover:bg-emerald-500/80",
        outline:
          "text-text-primary border-border-subtle",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
