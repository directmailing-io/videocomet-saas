"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string | boolean;
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, icon, type = "text", ...props }, ref) => {
    const hasError = Boolean(error);
    const base =
      "w-full bg-surface border rounded-squircle-sm text-sm text-ink placeholder:text-ink-muted transition-colors duration-150 focus:outline-none focus:ring-2 disabled:bg-surface-muted disabled:opacity-60";
    const stateClasses = hasError
      ? "border-danger focus:border-danger focus:ring-danger/20"
      : "border-line focus:border-brand focus:ring-brand/20";
    const padding = icon ? "pl-10 pr-4 py-3" : "px-4 py-3";

    if (icon) {
      return (
        <div className="relative w-full">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted [&>svg]:size-4">
            {icon}
          </span>
          <input
            ref={ref}
            type={type}
            className={cn(base, stateClasses, padding, className)}
            {...props}
          />
        </div>
      );
    }

    return (
      <input
        ref={ref}
        type={type}
        className={cn(base, stateClasses, padding, className)}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
