import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col bg-surface-soft">
      <header className="w-full px-6 py-5 border-b border-line bg-surface">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Logo />
          <Link href="/admin/login" className="text-xs text-ink-muted hover:text-ink transition-colors">
            Administrator-Login
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md animate-slide-up">
          <div className="card p-10">
            <h1 className="text-2xl font-bold tracking-tight mb-1">Willkommen zurück</h1>
            <p className="text-sm text-ink-muted mb-8">Logge dich in dein VIDEOCOMET-Konto ein.</p>

            <LoginForm role="user" />

            <p className="text-xs text-ink-muted text-center mt-8">
              Noch kein Konto? Konten werden vom Administrator angelegt.
            </p>
          </div>

          <p className="text-xs text-ink-muted text-center mt-6">
            Passwort vergessen? <Link href="/passwort-vergessen" className="text-brand-deep font-semibold hover:underline">Hier zurücksetzen</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
