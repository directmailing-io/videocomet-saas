"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

type ButtonVariant = "brand" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  loading?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-full transition-all duration-150 ease-spring disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 select-none whitespace-nowrap";

const variantClasses: Record<ButtonVariant, string> = {
  // Primary = dunkle Pill (Referenz-Look); Lavendel bleibt Akzent für subtle/Chips.
  brand:
    "bg-ink text-white shadow-ink hover:bg-black hover:-translate-y-0.5 active:translate-y-0",
  ghost:
    "bg-surface border border-line text-ink hover:bg-surface-muted hover:border-line",
  danger:
    "bg-danger text-white hover:opacity-90 hover:-translate-y-0.5 active:translate-y-0",
  subtle:
    "bg-brand-soft text-brand-deep hover:bg-brand-100",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "text-xs px-4 py-2 h-8",
  md: "text-sm px-6 py-3 h-10",
  lg: "text-base px-7 py-3.5 h-12",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "brand",
      size = "md",
      asChild,
      iconLeft,
      iconRight,
      loading,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";

    // When using asChild, Radix Slot requires a single child. We compose
    // iconLeft / children / iconRight into one fragment-style wrapper by
    // cloning the single child and injecting the helpers into its children.
    const inner = (
      <>
        {loading ? (
          <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          iconLeft && <span className="inline-flex shrink-0">{iconLeft}</span>
        )}
        {children}
        {iconRight && !loading && (
          <span className="inline-flex shrink-0">{iconRight}</span>
        )}
      </>
    );

    if (asChild && React.isValidElement(children)) {
      const childElement = children as React.ReactElement<{ children?: React.ReactNode }>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const slotProps: any = {
        ref,
        className: cn(base, variantClasses[variant], sizeClasses[size], className),
        ...props,
      };
      return (
        <Slot {...slotProps}>
          {React.cloneElement(childElement, {
            children: (
              <>
                {loading ? (
                  <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  iconLeft && (
                    <span className="inline-flex shrink-0">{iconLeft}</span>
                  )
                )}
                {childElement.props.children}
                {iconRight && !loading && (
                  <span className="inline-flex shrink-0">{iconRight}</span>
                )}
              </>
            ),
          })}
        </Slot>
      );
    }

    return (
      <Comp
        ref={ref}
        className={cn(
          base,
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {inner}
      </Comp>
    );
  }
);
Button.displayName = "Button";
