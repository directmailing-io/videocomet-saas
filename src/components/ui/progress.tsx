"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

export interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  value?: number | null;
  indeterminate?: boolean;
}

export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, indeterminate, ...props }, ref) => {
  const safeValue = typeof value === "number" ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={indeterminate ? undefined : safeValue}
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-line",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full bg-brand transition-transform duration-300 ease-spring rounded-full",
          indeterminate && "animate-pulse"
        )}
        style={{
          transform: indeterminate
            ? "translateX(0)"
            : `translateX(-${100 - safeValue}%)`,
          width: indeterminate ? "40%" : "100%",
        }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = "Progress";
