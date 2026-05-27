import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "brand" | "success" | "warn" | "danger" | "neutral";

const variantClasses: Record<BadgeVariant, string> = {
  brand: "bg-brand-soft text-brand-deep",
  success: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-muted text-ink-muted border border-line",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "neutral", dot, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap",
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            variant === "brand" && "bg-brand",
            variant === "success" && "bg-ok",
            variant === "warn" && "bg-warn",
            variant === "danger" && "bg-danger",
            variant === "neutral" && "bg-ink-muted"
          )}
        />
      )}
      {children}
    </span>
  )
);
Badge.displayName = "Badge";
