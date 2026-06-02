import type { Metadata } from "next";
import { requireUser } from "@/lib/auth-guard";
import { ActivityCenter } from "./activity-center";

export const metadata: Metadata = {
  title: "Aktivität · VideoComet",
  description:
    "Live-Übersicht aller Lead-Aktivitäten — Page-Views, Video-Plays und CTA-Klicks.",
};

/**
 * Top-Level-Aktivitäts-Center. Auth-Check via requireUser (redirected sonst
 * auf /login). Render-Logik komplett im Client — wir brauchen SSE, Drawer,
 * Tastatur-Bedienung, alles client-side.
 */
export default async function AktivitaetPage() {
  await requireUser();
  return <ActivityCenter scope="global" />;
}
