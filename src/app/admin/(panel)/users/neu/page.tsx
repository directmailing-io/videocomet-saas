import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { NewUserForm } from "./new-user-form";

export const dynamic = "force-dynamic";

export default function AdminNewUserPage() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Neuer User"
        subtitle="Lege einen neuen Account an. Optional kann sofort eine Setup-Mail mit Login-Daten gesendet werden."
        actions={
          <Button asChild variant="ghost" iconLeft={<ArrowLeft className="size-4" />}>
            <Link href="/admin/users">Zurück</Link>
          </Button>
        }
      />
      <NewUserForm />
    </div>
  );
}
