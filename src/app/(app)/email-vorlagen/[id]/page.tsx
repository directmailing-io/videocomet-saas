import { requireUser } from "@/lib/auth-guard";
import { notFound } from "next/navigation";
import { EmailTemplateEditor } from "./email-template-editor";

export const dynamic = "force-dynamic";

export default async function EmailTemplateEditorPage({
  params,
}: {
  params: { id: string };
}) {
  await requireUser();
  if (!params.id) notFound();
  return <EmailTemplateEditor templateId={params.id} />;
}
