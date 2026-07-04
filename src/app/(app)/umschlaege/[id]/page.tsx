import { requireUser } from "@/lib/auth-guard";
import { notFound } from "next/navigation";
import { EnvelopeEditor } from "./envelope-editor";

export const dynamic = "force-dynamic";

export default async function EnvelopeEditorPage({
  params,
}: {
  params: { id: string };
}) {
  await requireUser();
  if (!params.id) notFound();
  return <EnvelopeEditor templateId={params.id} />;
}
