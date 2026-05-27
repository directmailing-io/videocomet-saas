"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string | boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    const hasError = Boolean(error);
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full bg-surface border rounded-squircle-sm px-4 py-3 text-sm text-ink placeholder:text-ink-muted transition-colors duration-150 focus:outline-none focus:ring-2 disabled:bg-surface-muted disabled:opacity-60 min-h-[96px] resize-y",
          hasError
            ? "border-danger focus:border-danger focus:ring-danger/20"
            : "border-line focus:border-brand focus:ring-brand/20",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
