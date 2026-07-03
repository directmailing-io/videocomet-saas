import { requireUser } from "@/lib/auth-guard";
import { ContactsView } from "./contacts-view";

export const dynamic = "force-dynamic";

export default async function KontaktePage() {
  const auth = await requireUser();
  return <ContactsView userId={auth.user.id} />;
}
