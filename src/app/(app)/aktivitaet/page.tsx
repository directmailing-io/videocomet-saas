import type { Metadata } from "next";
import { requireUser } from "@/lib/auth-guard";
import { ActivityCenter } from "./activity-center";
import { AnalyticsSectionNav } from "../_components/analytics-section-nav";

export const metadata: Metadata = {
  title: "Aktivität · VideoComet",
  description:
    "Live-Übersicht aller Lead-Aktivitäten — Page-Views, Video-Plays und CTA-Klicks.",
};

export default async function AktivitaetPage() {
  await requireUser();
  return (
    <div className="flex flex-col gap-6">
      <AnalyticsSectionNav />
      <ActivityCenter scope="global" />
    </div>
  );
}
