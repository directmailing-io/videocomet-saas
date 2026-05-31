import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-guard";
import { createTpl } from "@/lib/db/queries/landingPageTemplates";
import type { LandingContentV2 } from "@/lib/landing-blocks/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server component that creates a fresh draft template and redirects
 * straight into the builder. Visiting `/landingpages/neu` is the "create
 * new" action; there is no UI to render here.
 *
 * The default content is a v2 block document with three pre-populated
 * blocks (Hero + Rich-Text + CTA-Banner) using the `{{firstName}}`
 * placeholder and German "Sie"-Form. Theme defaults to `clean` so the
 * first impression is the most neutral palette.
 */
export default async function NewLandingpagePage() {
  const { user } = await requireUser();

  const defaultContent: LandingContentV2 = {
    version: 2,
    theme: {},
    blocks: [
      {
        id: "hero_default",
        type: "hero",
        data: {
          headline: "{{firstName|Hallo}}, dieses Video ist für Sie",
          subheadline: "Ich habe es speziell für Sie aufgenommen.",
          showVideo: true,
          alignment: "center",
        },
      },
      {
        id: "rich_default",
        type: "rich-text",
        data: {
          markdown:
            "Schauen Sie sich das Video in Ruhe an. Wenn Sie Fragen haben oder direkt loslegen möchten, melden Sie sich gerne — ich freue mich auf Ihre Nachricht.",
        },
      },
      {
        id: "cta_default",
        type: "cta-banner",
        data: {
          headline: "Lassen Sie uns sprechen",
          subheadline: "Buchen Sie sich einen unverbindlichen Termin.",
          primaryButton: {
            label: "Termin buchen",
            url: "https://calendly.com",
          },
        },
      },
    ],
  };

  const tpl = await createTpl(user.id, {
    name: "Neue Vorlage",
    themeId: "clean",
    // `content` is a jsonb column typed as Record<string, unknown> at
    // the DB layer; LandingContentV2 is structurally compatible but
    // has named keys, so cast through `unknown` to satisfy the index
    // signature without weakening our own type.
    content: defaultContent as unknown as Record<string, unknown>,
  });

  redirect(`/landingpages/${tpl.id}`);
}
