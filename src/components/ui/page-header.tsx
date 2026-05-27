import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}

export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ className, title, subtitle, actions, eyebrow, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-6 mb-6 border-b border-line",
        className
      )}
      {...props}
    >
      <div className="flex flex-col gap-1.5 min-w-0">
        {eyebrow && <div>{eyebrow}</div>}
        <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-ink leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-ink-muted leading-relaxed max-w-2xl">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {actions}
        </div>
      )}
    </div>
  )
);
PageHeader.displayName = "PageHeader";
