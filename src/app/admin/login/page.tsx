import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { LoginForm } from "../../login/login-form";

export default function AdminLoginPage() {
  return (
    <div className="min-h-screen flex flex-col bg-surface-soft">
      <header className="w-full px-6 py-5 border-b border-line bg-surface">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Logo />
          <Link href="/login" className="text-xs text-ink-muted hover:text-ink transition-colors">
            Zum User-Login
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md animate-slide-up">
          <div className="card p-10">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-brand-soft text-brand-deep text-[11px] font-bold uppercase tracking-wider mb-4">
              Administrator
            </div>
            <h1 className="text-2xl font-bold tracking-tight mb-1">Administrator-Bereich</h1>
            <p className="text-sm text-ink-muted mb-8">Nur für Systemadministratoren. Alle Aktionen werden protokolliert.</p>


            <LoginForm role="admin" />
          </div>
        </div>
      </main>
    </div>
  );
}
