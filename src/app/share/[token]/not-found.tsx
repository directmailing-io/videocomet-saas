import { Card, CardContent } from "@/components/ui/card";

/**
 * 404-State für `/share/<token>`. Wird gerendert wenn der Token im
 * `getActiveShareByToken()`-Lookup nicht aktiv (oder revoked / unbekannt) ist.
 *
 * Bewusst kein Passwort-Prompt — wir wollen keinem Angreifer signalisieren,
 * dass der Token mal existiert hat. „Nicht gefunden oder zurückgezogen" deckt
 * beides ab.
 */
export default function ShareNotFound() {
  return (
    <section className="mx-auto w-full max-w-md px-5 py-16">
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <h1 className="text-xl font-semibold text-ink">Link nicht verfügbar</h1>
          <p className="text-sm text-ink-muted leading-relaxed">
            Link nicht gefunden oder wurde zurückgezogen.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
