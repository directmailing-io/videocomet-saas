import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { DemoSection } from "@/components/marketing/DemoSection";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="w-full px-6 py-5 border-b border-line bg-surface">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-3">
            <Link href="/login" className="btn-ghost">Login</Link>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-2xl text-center animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-soft text-brand-deep text-xs font-semibold mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-brand" />
            Persönliche Outreach-Videos in Serie
          </div>
          <h1 className="text-5xl font-bold tracking-tight leading-tight mb-5 text-balance">
            Ein Video. <span className="text-brand-deep">Hunderte</span> persönliche Empfänger.
          </h1>
          <p className="text-lg text-ink-muted mb-10 text-balance">
            Lade deine Kontaktliste hoch, nimm einmal deine Webcam auf, und VIDEOCOMET generiert
            personalisierte Videos, Landingpages und PDF-Briefe für jeden Kontakt.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/login" className="btn-brand">Zum Login</Link>
          </div>
          <p className="text-xs text-ink-muted mt-8">
            Konten werden vom Administrator angelegt. Keine öffentliche Registrierung.
          </p>
        </div>
      </main>

      <DemoSection />

      <footer className="w-full px-6 py-5 border-t border-line bg-surface">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-ink-muted">
          <span>© {new Date().getFullYear()} VIDEOCOMET</span>
          <span>Made in Germany</span>
        </div>
      </footer>
    </div>
  );
}
