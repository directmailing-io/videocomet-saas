import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReviewNotFound() {
  return (
    <section className="mx-auto w-full max-w-md px-5 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Link nicht gefunden</CardTitle>
          <CardDescription>
            Der Feedback-Link ist entweder abgelaufen, wurde deaktiviert oder es liegt ein Tippfehler vor.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-ink-muted">
          Bitte prüfe den Link nochmal. Falls du weiterhin ein Problem hast, wende dich an den Absender.
          <div className="mt-4">
            <Link href="/" className="text-brand-deep font-semibold underline">
              Zur VIDEOCOMET-Startseite
            </Link>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
