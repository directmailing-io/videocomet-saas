import { requireUser } from "@/lib/auth-guard";
import { EmailTemplatesView } from "./email-templates-view";

export const dynamic = "force-dynamic";

export default async function EmailVorlagenPage() {
  await requireUser();
  return <EmailTemplatesView />;
}
