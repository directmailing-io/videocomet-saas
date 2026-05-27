import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { Shield } from "lucide-react";
import { LoginForm } from "../../login/login-form";

export default function AdminLoginPage() {
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
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-soft text-brand-deep text-[11px] font-bold uppercase tracking-wider mb-4">
                <Shield className="w-3 h-3" />
                Administrator
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-center">
                Administrator-Bereich
              </h1>
              <p className="text-sm text-ink-muted text-center mt-2">
                Nur für Systemadministratoren. Alle Aktionen werden protokolliert.
              </p>
            </div>

            <LoginForm role="admin" />
          </div>
        </div>

        <p className="text-xs text-ink-muted text-center mt-6">
          <Link href="/login" className="hover:text-ink transition-colors">
            Zum User-Login
          </Link>
        </p>
      </div>
    </div>
  );
}
