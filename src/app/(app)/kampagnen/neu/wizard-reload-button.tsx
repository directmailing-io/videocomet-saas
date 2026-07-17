"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WizardReloadButtonProps {
  onReload: () => void;
  reloading: boolean;
  label?: string;
  variant?: "ghost" | "subtle";
  className?: string;
}

/**
 * Lädt die Server-Daten des Wizards neu (Vorlagen, Custom-LPs, Domains,
 * Mediathek), ohne den Wizard-State zu verlieren. Gedacht für den Flow
 * „Asset im neuen Tab erstellt → zurück → Aktualisieren klicken".
 */
export function WizardReloadButton({
  onReload,
  reloading,
  label = "Aktualisieren",
  variant = "ghost",
  className,
}: WizardReloadButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={onReload}
      disabled={reloading}
      className={className}
      iconLeft={
        <RefreshCw className={cn("size-3.5", reloading && "animate-spin")} />
      }
      title="Neu erstellte Vorlagen, Domains und Medien laden — der Wizard-Fortschritt bleibt erhalten."
    >
      {reloading ? "Wird geladen …" : label}
    </Button>
  );
}
