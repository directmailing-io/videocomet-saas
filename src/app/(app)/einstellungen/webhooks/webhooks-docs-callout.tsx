import { ArrowRight, BookOpen } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function WebhooksDocsCallout() {
  return (
    <Card className="bg-brand-soft/40">
      <CardContent className="p-5 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-squircle-sm bg-brand text-white shadow-brand">
          <BookOpen className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink">
            Verbinde VideoComet mit Zapier, Make oder jedem HTTPS-Endpunkt.
          </p>
          <p className="text-xs text-ink-soft mt-0.5">
            Schritt-für-Schritt-Anleitungen mit Screenshots — in 3 Minuten
            startklar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button asChild variant="ghost" size="sm" iconRight={<ArrowRight className="size-3.5" />}>
            <Link href="/docs/webhooks/zapier">Zapier einrichten</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" iconRight={<ArrowRight className="size-3.5" />}>
            <Link href="/docs/webhooks/make">Make.com einrichten</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" iconRight={<ArrowRight className="size-3.5" />}>
            <Link href="/docs/webhooks">Übersicht</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
