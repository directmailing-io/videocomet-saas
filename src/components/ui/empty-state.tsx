import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon, title, subtitle, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-16 rounded-squircle-md",
        className
      )}
      {...props}
    >
      {icon && (
        <div className="flex size-14 items-center justify-center rounded-squircle-md bg-brand-soft text-brand-deep mb-5 [&>svg]:size-7">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-ink mb-1.5">{title}</h3>
      {subtitle && (
        <p className="text-sm text-ink-muted max-w-sm leading-relaxed">
          {subtitle}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
);
EmptyState.displayName = "EmptyState";
