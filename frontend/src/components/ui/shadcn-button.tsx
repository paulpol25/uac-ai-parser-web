import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/utils/cn"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-bg-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-brand-primary text-text-inverse hover:bg-brand-primary-hover shadow-sm",
        destructive: "bg-error text-white hover:bg-error/90",
        outline: "border border-border-subtle bg-transparent hover:bg-bg-hover hover:text-text-primary text-text-secondary",
        secondary: "bg-bg-elevated text-text-primary hover:bg-bg-hover border border-border-subtle",
        ghost: "hover:bg-bg-hover hover:text-text-primary text-text-secondary",
        link: "text-brand-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ShadcnButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const ShadcnButton = React.forwardRef<HTMLButtonElement, ShadcnButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
ShadcnButton.displayName = "ShadcnButton"

export { ShadcnButton, buttonVariants }
