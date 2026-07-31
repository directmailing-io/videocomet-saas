import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { getRun } from "@/lib/db/queries/runs";
import type { DedupeConfig } from "@/lib/dedupe/types";
import { RunWizard, type RunWizardResume } from "./run-wizard";

/** Gestalt der Preview-Daten, wie sie upload-leads am Run persistiert. */
interface StoredParsed {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
}

interface StoredColumnMapping {
  parsed?: StoredParsed;
  mapping?: Record<string, string>;
}

/**
 * Server entry for the new-run wizard. Resolves the parent campaign
 * (tenant-aware) and forwards it into the client wizard.
 *
 * Mit `?resume=<runId>` wird eine unfertige Runde (draft/mapping)
 * fortgesetzt: Preview + Legacy-Mapping kommen aus `runs.column_mapping`,
 * der Wizard startet dann direkt in Step 1.
 */
export default async function NewRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ resume?: string }>;
}) {
  const { id } = await params;
  const { resume } = await searchParams;
  const { user } = await requireUser();

  let campaign;
  try {
    campaign = await getCampaign(id, user.id);
  } catch {
    notFound();
  }

  let resumeState: RunWizardResume | undefined;
  if (resume) {
    try {
      const run = await getRun(resume, user.id);
      if (
        run.campaignId === campaign.id &&
        (run.status === "draft" || run.status === "mapping")
      ) {
        const cm = (run.columnMapping ?? {}) as StoredColumnMapping;
        resumeState = {
          runId: run.id,
          runName: run.name,
          preview: cm.parsed
            ? {
                headers: cm.parsed.headers,
                // Wie beim frischen Upload: nur die ersten 20 Zeilen in
                // die Client-Preview (Tabelle + Dedupe-Vorschau).
                rows: cm.parsed.rows.slice(0, 20),
                totalRows: cm.parsed.totalRows,
                truncated: cm.parsed.totalRows > cm.parsed.rows.length,
              }
            : null,
          mapping: cm.mapping ?? {},
          dedupeConfig: (run.dedupeConfig as DedupeConfig | null) ?? null,
        };
      }
    } catch {
      // Run existiert nicht (mehr) oder gehört nicht dem User → frischer Wizard.
    }
  }

  // Spiegel der `abActive`-Bedingung im Start-Endpoint: nur wenn der Test
  // aktiviert ist UND beide Brief-URLs vorliegen, zeigt der Wizard die
  // Split-Regel und schickt sie beim Start mit.
  const abTestingActive =
    campaign.abTestingEnabled &&
    campaign.pdfEnabled &&
    Boolean(campaign.pdfGoogleDocsUrl?.trim()) &&
    Boolean(campaign.pdfGoogleDocsUrlB?.trim());

  return (
    <RunWizard
      campaignId={campaign.id}
      campaignName={campaign.name}
      pdfEnabled={campaign.pdfEnabled}
      campaignMode={
        campaign.mode === "webcam-only" ? "webcam-only" : "with-presentation"
      }
      abTestingActive={abTestingActive}
      abDefaultMode={campaign.abSplitMode}
      abDefaultWeightA={campaign.abSplitWeightA}
      resume={resumeState}
    />
  );
}
