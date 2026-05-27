import { requireAdmin } from "@/lib/auth-guard";
import { getUserById } from "@/lib/db/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { AdminSettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const { user: sessionUser } = await requireAdmin();
  const full = await getUserById(sessionUser.id);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Einstellungen"
        subtitle="Verwalte dein Administrator-Profil und ändere dein Passwort."
      />
      <AdminSettingsClient
        initialProfile={{
          id: full.id,
          email: full.email,
          firstName: full.firstName,
          lastName: full.lastName,
          phone: full.phone,
        }}
      />
    </div>
  );
}
