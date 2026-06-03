import { Logo } from "@/components/ui/logo";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-line/60 bg-surface/80">
        <div className="mx-auto max-w-2xl w-full flex items-center justify-between px-5 py-4">
          <Logo />
        </div>
      </header>
      <section className="flex-1 mx-auto w-full max-w-md px-5 py-16 text-center space-y-3">
        <h1 className="text-2xl font-bold text-ink">Link nicht gefunden</h1>
        <p className="text-sm text-ink-muted">
          Bitte prüfe den Link, oder frage den Absender nach einem neuen.
        </p>
      </section>
    </main>
  );
}
