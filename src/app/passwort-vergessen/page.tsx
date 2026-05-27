import Link from "next/link";
import { AuthShell } from "@/components/layouts/AuthShell";
import { RequestForm } from "./request-form";

export const metadata = {
  title: "Passwort vergessen | VIDEOCOMET",
};

export default function PasswortVergessenPage() {
  return (
    <AuthShell
      title="Passwort vergessen"
      subtitle="Gib deine E-Mail-Adresse ein. Wir senden dir einen Link zum Zurücksetzen."
      footer={
        <Link href="/login" className="hover:text-ink transition-colors">
          Zurück zum Login
        </Link>
      }
    >
      <RequestForm />
    </AuthShell>
  );
}
