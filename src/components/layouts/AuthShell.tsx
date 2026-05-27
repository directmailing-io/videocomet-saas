import * as React from "react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

export interface AuthShellProps {
  children: React.ReactNode;
  badge?: React.ReactNode;
  title?: string;
  subtitle?: string;
  footer?: React.ReactNode;
  className?: string;
}

export function AuthShell({
  children,
  badge,
  title,
  subtitle,
  footer,
  className,
}: AuthShellProps) {
  return (
    <div
      className={cn(
        "relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-surface-soft via-surface to-brand-50 px-4 py-12",
        className
      )}
    >
      {/* Brand glow blur element */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 size-[480px] rounded-full bg-brand/30 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-40 size-[440px] rounded-full bg-brand-300/40 blur-[120px]"
      />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <Logo variant="horizontal" height={32} />
          {badge}
        </div>

        <div className="w-full rounded-squircle-xl border border-line bg-surface/95 backdrop-blur-sm shadow-lift p-8">
          {(title || subtitle) && (
            <div className="mb-6 text-center">
              {title && (
                <h1 className="text-xl font-bold tracking-tight text-ink">
                  {title}
                </h1>
              )}
              {subtitle && (
                <p className="mt-1.5 text-sm text-ink-muted leading-relaxed">
                  {subtitle}
                </p>
              )}
            </div>
          )}
          {children}
        </div>

        {footer && (
          <div className="text-center text-xs text-ink-muted">{footer}</div>
        )}
      </div>
    </div>
  );
}
