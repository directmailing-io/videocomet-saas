"use client";

/**
 * CRM-Tab im Campaign-Detail.
 *
 * Bündelt:
 *   - Settings-Formular (Integration wählen, Lead-Matching, Events, Statische
 *     Felder, Speichern/Test-Sync)
 *   - Log-Viewer mit Filter + Polling
 *
 * Bei erfolgreichem Test-Sync werden die zurückgegebenen logIds an den
 * LogViewer durchgereicht und dort kurz visuell hervorgehoben.
 */

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CrmSettingsForm } from "./crm-settings-form";
import { CrmLogViewer } from "./crm-log-viewer";

export interface CrmTabProps {
  campaignId: string;
  campaignName: string;
}

export function CrmTab({ campaignId, campaignName }: CrmTabProps) {
  const [highlightIds, setHighlightIds] = React.useState<string[]>([]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="p-6">
          <CrmSettingsForm
            campaignId={campaignId}
            campaignName={campaignName}
            onTestLogged={(ids) => setHighlightIds(ids)}
          />
        </CardContent>
      </Card>

      <section id="crm-log" className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">CRM-Event-Log</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            Alle Push-Versuche dieser Kampagne — inklusive Test-Syncs und
            Worker-Retries. Aktualisiert sich automatisch.
          </p>
        </div>
        <CrmLogViewer campaignId={campaignId} highlightIds={highlightIds} />
      </section>
    </div>
  );
}
