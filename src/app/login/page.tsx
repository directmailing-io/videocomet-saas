import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-surface-soft via-surface to-brand-50 p-4">
      <div className="w-full max-w-md animate-slide-up">
        <div className="card relative overflow-hidden">
          <div
            aria-hidden
            className="absolute -top-32 left-1/2 -translate-x-1/2 w-[420px] h-[420px] bg-brand opacity-[0.08] blur-3xl rounded-full pointer-events-none"
          />
          <div className="relative p-10">
            <div className="flex flex-col items-center mb-8">
              <Link href="/" className="mb-6">
                <Logo height={32} />
              </Link>
              <h1 className="text-2xl font-bold tracking-tight text-center">
                Willkommen zurück
              </h1>
              <p className="text-sm text-ink-muted text-center mt-2">
                Logge dich in dein VIDEOCOMET-Konto ein.
              </p>
            </div>

            <LoginForm role="user" />

            <div className="mt-8 pt-6 border-t border-line-soft">
              <p className="text-xs text-ink-muted text-center">
                Noch kein Konto? Konten werden vom Administrator angelegt.
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-ink-muted text-center mt-6">
          <Link href="/admin/login" className="hover:text-ink transition-colors">
            Administrator-Login
          </Link>
        </p>
      </div>
    </div>
  );
}
