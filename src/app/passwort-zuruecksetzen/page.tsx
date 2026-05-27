import Link from "next/link";
import { AuthShell } from "@/components/layouts/AuthShell";
import { ResetForm } from "./reset-form";

export const metadata = {
  title: "Passwort zurücksetzen | VIDEOCOMET",
};

interface PageProps {
  searchParams?: { token?: string | string[] };
}

export default function PasswortZuruecksetzenPage({ searchParams }: PageProps) {
  const raw = searchParams?.token;
  const token = Array.isArray(raw) ? raw[0] : raw;

  if (!token) {
    return (
      <AuthShell
        title="Ungültiger Link"
        subtitle="Dieser Reset-Link ist unvollständig. Fordere bitte einen neuen an."
        footer={
          <Link href="/passwort-vergessen" className="hover:text-ink transition-colors">
            Neuen Link anfordern
          </Link>
        }
      >
        <div className="text-sm text-ink-muted text-center">
          Im Link fehlt der Token-Parameter.
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Neues Passwort vergeben"
      subtitle="Wähle ein neues Passwort. Mindestens 8 Zeichen."
      footer={
        <Link href="/login" className="hover:text-ink transition-colors">
          Zurück zum Login
        </Link>
      }
    >
      <ResetForm token={token} />
    </AuthShell>
  );
}
