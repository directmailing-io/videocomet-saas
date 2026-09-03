"use client";

/**
 * Client-Shell der Runden-Seite: EIN Seitenkopf mit Status-Zeile und
 * höchstens einem Phasen-Primary, darunter die Tabs Videos / Versand /
 * Aktivität. Videos- und Versand-Tab bleiben gemountet, damit SSE-Stream
 * und Bulk-Auswahl einen Tab-Wechsel überleben.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, Send } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LiveTable, type LiveTableProps } from "./live-table";
import { ActivityCenter } from "@/app/(app)/aktivitaet/activity-center";
import { VersandRunView } from "@/app/(app)/versand/[runId]/versand-run-view";

export type RunTab = "videos" | "versand" | "aktivitaet";

type VersandProps = React.ComponentProps<typeof VersandRunView>;

export function RunPageShell({
  runName,
  campaignId,
  campaignName,
  defaultTab,
  statusLine,
  primaryLabel,
  liveTable,
  versand,
}: {
  runName: string;
  campaignId: string;
  campaignName: string;
  defaultTab: RunTab;
  statusLine: string;
  primaryLabel: string | null;
  liveTable: Omit<LiveTableProps, "onOpenVersand">;
  versand: VersandProps;
}) {
  const [tab, setTab] = React.useState<RunTab>(defaultTab);
  const openVersand = React.useCallback(() => setTab("versand"), []);

  return (
    <>
      <PageHeader
        title={runName}
        subtitle={statusLine}
        actions={
          <>
            <Button
              asChild
              variant="ghost"
              iconLeft={<ArrowLeft className="size-4" />}
            >
              <Link href={`/kampagnen/${campaignId}`}>Zur Kampagne</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href={`/kampagnen/${campaignId}/runs/${versand.runId}/analytics`}>
                <BarChart3 className="size-4" />
                Auswertung
              </Link>
            </Button>
            {primaryLabel && tab !== "versand" && (
              <Button
                iconLeft={<Send className="size-4" />}
                onClick={openVersand}
              >
                {primaryLabel}
              </Button>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as RunTab)}>
        <TabsList>
          <TabsTrigger value="videos">Videos</TabsTrigger>
          <TabsTrigger value="versand">Versand</TabsTrigger>
          <TabsTrigger value="aktivitaet">Aktivität</TabsTrigger>
        </TabsList>

        <TabsContent
          value="videos"
          forceMount
          className="data-[state=inactive]:hidden"
        >
          <LiveTable {...liveTable} onOpenVersand={openVersand} />
        </TabsContent>

        <TabsContent
          value="versand"
          forceMount
          className="data-[state=inactive]:hidden"
        >
          <VersandRunView {...versand} />
        </TabsContent>

        <TabsContent value="aktivitaet">
          <ActivityCenter
            scope="run"
            campaignId={campaignId}
            campaignName={campaignName}
            runId={versand.runId}
            runName={runName}
            embedded
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
