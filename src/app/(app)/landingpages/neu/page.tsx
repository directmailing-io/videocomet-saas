import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-guard";
import { createTpl } from "@/lib/db/queries/landingPageTemplates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server component that creates a fresh draft template and redirects
 * straight into the builder. Visiting `/landingpages/neu` is the "create
 * new" action; there is no UI to render here.
 *
 * The default content mirrors what the builder/preview expects (headline,
 * body, two CTAs). Theme defaults to `clean` so the first impression is
 * the most neutral palette.
 */
export default async function NewLandingpagePage() {
  const { user } = await requireUser();

  const tpl = await createTpl(user.id, {
    name: "Neue Vorlage",
    themeId: "clean",
    content: {
      headline: "Hey {{firstName}}, das hier ist fuer dich!",
      bodyText:
        "Ich habe dieses Video speziell fuer dich aufgenommen. Schau es dir an und melde dich bei Fragen.",
      primaryButtonText: "Termin buchen",
      primaryButtonUrl: "https://calendly.com",
      secondaryButtonText: "Mehr erfahren",
      secondaryButtonUrl: "#",
      footnote: "",
    },
  });

  redirect(`/landingpages/${tpl.id}`);
}
