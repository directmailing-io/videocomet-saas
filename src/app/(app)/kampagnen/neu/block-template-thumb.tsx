"use client";

import * as React from "react";
import { BLOCK_REGISTRY } from "@/components/landing-blocks";
import { LandingThemeProvider } from "@/components/landing-blocks/theme-provider";
import { migrateLegacyContent } from "@/lib/landing-blocks/migrate";
import { extractThemeAndBrand } from "@/lib/landing-theme/extract";
import { Play } from "lucide-react";

/**
 * Miniatur-Vorschau einer Block-Landingpage für die Vorlagen-Galerie.
 *
 * Rendert die echten Blöcke der Vorlage in einem 4x breiten Container und
 * skaliert ihn per CSS-Transform auf Kachelgröße — so zeigt die Kachel den
 * tatsächlichen Seitenkopf statt einer leeren Farbfläche.
 */

const SAMPLE_LEAD: Record<string, string> = {
  firstName: "Max",
  lastName: "Mustermann",
  company: "Mustermann GmbH",
  companyName: "Mustermann GmbH",
  email: "max@mustermann.de",
  jobTitle: "Geschäftsführer",
};

export function BlockTemplateThumb({
  content,
  themeId,
}: {
  content: unknown;
  themeId: string;
}) {
  const v2 = React.useMemo(() => migrateLegacyContent(content), [content]);
  const { theme, brand } = React.useMemo(
    () => extractThemeAndBrand(content, themeId),
    [content, themeId],
  );

  if (v2.blocks.length === 0) {
    return (
      <div
        className="aspect-[4/3] w-full rounded-squircle-sm"
        style={{ background: theme.colors.bg }}
        aria-hidden
      />
    );
  }

  return (
    <div
      className="relative aspect-[4/3] w-full overflow-hidden rounded-squircle-sm bg-surface-soft pointer-events-none select-none"
      aria-hidden
    >
      <div className="absolute left-0 top-0 w-[400%] origin-top-left scale-[0.25]">
        <LandingThemeProvider theme={theme} brand={brand} showFooter={false}>
          {v2.blocks.map((block) => {
            const Component = BLOCK_REGISTRY[block.type];
            if (!Component) return null;
            return (
              <Component
                key={block.id}
                data={block.data}
                style={block.style}
                variant={block.variant}
                theme={v2.theme}
                leadData={SAMPLE_LEAD}
                leadId="preview"
                slot={block.type === "hero" ? <ThumbVideoStub /> : undefined}
              />
            );
          })}
        </LandingThemeProvider>
      </div>
    </div>
  );
}

function ThumbVideoStub() {
  return (
    <div className="aspect-video w-full max-w-2xl mx-auto rounded-2xl bg-ink flex items-center justify-center">
      <span className="inline-flex size-16 items-center justify-center rounded-full bg-white/20">
        <Play className="size-8 text-white fill-white" />
      </span>
    </div>
  );
}
