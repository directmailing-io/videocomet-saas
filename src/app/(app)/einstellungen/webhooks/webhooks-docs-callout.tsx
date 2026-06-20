"use client";

/**
 * Info-Card am Top der Webhooks-Page — zeigt eine kurze Erklärung und
 * Quick-Links zu den Zapier/Make-Setup-Guides. Die Doku-Routen existieren
 * noch nicht (kommt in einem späteren Sprint), daher zeigen die Buttons
 * einen Toast statt einer harten Navigation.
 */

import * as React from "react";
import { ArrowRight, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";

export function WebhooksDocsCallout() {
  const { toast } = useToast();

  function notifyDocsPending(target: "zapier" | "make") {
    toast({
      title: "Doku folgt",
      description:
        target === "zapier"
          ? "Die Zapier-Setup-Anleitung wird noch fertiggestellt."
          : "Die Make.com-Setup-Anleitung wird noch fertiggestellt.",
      variant: "default",
    });
  }

  return (
    <Card className="border-brand/20 bg-brand-soft/40">
      <CardContent className="p-5 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-squircle-sm bg-brand text-white shadow-brand">
          <BookOpen className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink">
            Verbinde VideoComet mit Zapier, Make oder jedem HTTPS-Endpunkt.
          </p>
          <p className="text-xs text-ink-soft mt-0.5">
            Klick-Anleitungen für die populärsten No-Code-Tools — inkl.
            Signatur-Verifikation und Beispiel-Payloads.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => notifyDocsPending("zapier")}
            iconRight={<ArrowRight className="size-3.5" />}
          >
            Zapier einrichten
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => notifyDocsPending("make")}
            iconRight={<ArrowRight className="size-3.5" />}
          >
            Make.com einrichten
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
