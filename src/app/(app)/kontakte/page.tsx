import { requireUser } from "@/lib/auth-guard";
import { KontakteView } from "./kontakte-view";

export const dynamic = "force-dynamic";

export default async function KontaktePage() {
  const auth = await requireUser();
  return <KontakteView userId={auth.user.id} />;
}
