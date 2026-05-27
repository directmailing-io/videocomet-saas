"use client";

import * as React from "react";
import { LayoutTemplate, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

interface Template {
  id: string;
  name: string;
  themeId: string;
}

export interface WizardStep4Props {
  templates: Template[];
  value: string | null;
  onChange: (id: string) => void;
}

const THEME_PREVIEW: Record<string, string> = {
  noir: "bg-gradient-to-br from-ink to-ink-soft",
  clean: "bg-gradient-to-br from-surface to-surface-muted border border-line",
  gradient: "bg-gradient-to-br from-brand to-brand-deep",
  warm: "bg-gradient-to-br from-warn to-brand",
};

export function WizardStep4Landingpage({
  templates,
  value,
  onChange,
}: WizardStep4Props) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink mb-1">
        Landingpage-Vorlage waehlen
      </h2>
      <p className="text-sm text-ink-muted mb-6">
        Diese Vorlage wird als personalisierte Landingpage fuer jeden Lead
        verwendet.
      </p>

      {templates.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplate />}
          title="Noch keine Vorlagen"
          subtitle="Lege im Bereich Landingpages eine Vorlage an, bevor du sie hier auswaehlen kannst."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((tpl) => {
            const active = tpl.id === value;
            const preview =
              THEME_PREVIEW[tpl.themeId] ?? THEME_PREVIEW.clean;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => onChange(tpl.id)}
                className={cn(
                  "text-left rounded-squircle-md border transition-all relative",
                  active
                    ? "border-brand ring-2 ring-brand/30"
                    : "border-line hover:border-brand/50",
                )}
              >
                {active && (
                  <span className="absolute top-3 right-3 z-10 inline-flex size-6 items-center justify-center rounded-full bg-brand text-white">
                    <Check className="size-3.5" />
                  </span>
                )}
                <Card className="border-0 shadow-none">
                  <CardContent className="p-3">
                    <div
                      className={cn(
                        "aspect-[4/3] rounded-squircle-sm mb-3",
                        preview,
                      )}
                    />
                    <p className="text-sm font-semibold text-ink truncate">
                      {tpl.name}
                    </p>
                    <p className="text-xs text-ink-muted capitalize">
                      Theme: {tpl.themeId}
                    </p>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
