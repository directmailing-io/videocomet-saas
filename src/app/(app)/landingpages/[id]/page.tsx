import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-guard";
import { getTpl } from "@/lib/db/queries/landingPageTemplates";
import { LpBuilder } from "./lp-builder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LandingpageBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireUser();

  let tpl;
  try {
    tpl = await getTpl(id, user.id);
  } catch {
    notFound();
  }

  return (
    <LpBuilder
      template={{
        id: tpl.id,
        name: tpl.name,
        themeId: tpl.themeId,
        content: (tpl.content ?? {}) as Record<string, unknown>,
      }}
    />
  );
}
