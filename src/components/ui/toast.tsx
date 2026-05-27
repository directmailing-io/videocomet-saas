"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X, CircleCheck, TriangleAlert, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      "fixed top-4 right-4 z-[100] flex max-h-screen w-full max-w-[400px] flex-col gap-2 outline-none",
      className
    )}
    {...props}
  />
));
ToastViewport.displayName = "ToastViewport";

type ToastVariant = "default" | "success" | "danger";

const variantClasses: Record<ToastVariant, string> = {
  default: "bg-surface border-line text-ink",
  success: "bg-surface border-ok/30 text-ink",
  danger: "bg-surface border-danger/30 text-ink",
};

const variantIcon: Record<ToastVariant, React.ReactNode> = {
  default: <Info className="size-5 text-brand shrink-0" />,
  success: <CircleCheck className="size-5 text-ok shrink-0" />,
  danger: <TriangleAlert className="size-5 text-danger shrink-0" />,
};

export interface ToastProps
  extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> {
  variant?: ToastVariant;
}

export const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  ToastProps
>(({ className, variant = "default", duration = 4000, ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    duration={duration}
    className={cn(
      "group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-squircle-md border p-4 shadow-card-hover transition-all",
      "data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none",
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-top-full data-[swipe=end]:animate-out",
      variantClasses[variant],
      className
    )}
    {...props}
  >
    {variantIcon[variant]}
    <div className="flex-1 min-w-0 grid gap-0.5">{props.children}</div>
    <ToastPrimitive.Close className="shrink-0 rounded-full p-1 text-ink-muted hover:text-ink hover:bg-line-soft transition-colors">
      <X className="size-4" />
    </ToastPrimitive.Close>
  </ToastPrimitive.Root>
));
Toast.displayName = "Toast";

export const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn("text-sm font-semibold leading-tight", className)}
    {...props}
  />
));
ToastTitle.displayName = "ToastTitle";

export const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn("text-sm text-ink-muted leading-relaxed", className)}
    {...props}
  />
));
ToastDescription.displayName = "ToastDescription";

export const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-full px-3 text-xs font-semibold transition-colors bg-brand-soft text-brand-deep hover:bg-brand-100",
      className
    )}
    {...props}
  />
));
ToastAction.displayName = "ToastAction";

export const ToastClose = ToastPrimitive.Close;
