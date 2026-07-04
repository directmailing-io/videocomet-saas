import { requireUser } from "@/lib/auth-guard";
import { EnvelopesView } from "./envelopes-view";

export const dynamic = "force-dynamic";

export default async function UmschlaegePage() {
  const auth = await requireUser();
  return <EnvelopesView userId={auth.user.id} />;
}
