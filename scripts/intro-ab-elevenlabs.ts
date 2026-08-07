/**
 * A/B-Test: identisches Intro-Preview einmal mit Fish (Kampagnen-Stimme
 * aus intro_calibrations.voice_fish_model_id) und einmal mit ElevenLabs
 * (Instant-Clone aus derselben Webcam-Tonspur). Gleicher Lead, gleiche
 * Kalibrierung, gleiche EQ/Loudness/Lipsync-Kette — nur die TTS-Synthese
 * unterscheidet sich. Ergebnis-MP4s landen unter voice-ab/ auf Bunny.
 *
 * Aufruf (Worker-Container):
 *   ELEVENLABS_API_KEY=... npx tsx scripts/intro-ab-elevenlabs.ts
 */

import "dotenv/config";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  campaigns,
  introCalibrations,
  leads,
  mediaItems,
  runs,
} from "../src/lib/db/schema";
import { resolveIntroSubstitutions } from "../src/lib/intro-name-check";
import { DEFAULT_TTS_TEMPLATE } from "../src/lib/intro";
import { uploadFile } from "../src/lib/bunny/storage";
import { runFfmpeg } from "../src/worker/lib/ffmpeg";
import { generatePersonalizedWebcam } from "../src/worker/lib/intro-engine";

const RUN_ID = "e56a2231-2f45-4df2-84c2-a5c12ccf3254";
const TRIM_TO_SEC = 15;
const EL_BASE = "https://api.elevenlabs.io";
const EL_MODEL = "eleven_multilingual_v2";

function elKey(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY fehlt");
  return k;
}

async function elCreateVoice(mp3Path: string): Promise<string> {
  const form = new FormData();
  form.append("name", `videocomet-ab-${Date.now().toString(36)}`);
  form.append(
    "files",
    new Blob([await readFile(mp3Path)], { type: "audio/mpeg" }),
    "sample.mp3",
  );
  const res = await fetch(`${EL_BASE}/v1/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": elKey() },
    body: form,
  });
  if (!res.ok) throw new Error(`EL voices/add HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { voice_id: string };
  return json.voice_id;
}

async function elTts(voiceId: string, text: string): Promise<Buffer> {
  const res = await fetch(
    `${EL_BASE}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": elKey(), "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: EL_MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.85 },
      }),
    },
  );
  if (!res.ok) throw new Error(`EL tts HTTP ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
  const [row] = await db
    .select({
      userId: runs.userId,
      webcamMediaId: campaigns.webcamMediaId,
      webcamUrl: mediaItems.publicUrl,
    })
    .from(runs)
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .innerJoin(mediaItems, eq(mediaItems.id, campaigns.webcamMediaId))
    .where(eq(runs.id, RUN_ID))
    .limit(1);
  if (!row?.webcamUrl) throw new Error("run/campaign/webcam nicht gefunden");

  const [calibration] = await db
    .select()
    .from(introCalibrations)
    .where(eq(introCalibrations.mediaItemId, row.webcamMediaId!))
    .limit(1);
  if (calibration?.status !== "ready") throw new Error("Kalibrierung nicht ready");
  if (calibration.voiceStatus !== "ready" || !calibration.voiceFishModelId) {
    throw new Error(
      `Kampagnen-Stimme nicht ready (voice_status=${calibration?.voiceStatus}, error=${calibration?.voiceError})`,
    );
  }

  const template = calibration.ttsTemplate?.trim() || DEFAULT_TTS_TEMPLATE;
  const rows = await db
    .select({ id: leads.id, data: leads.data })
    .from(leads)
    .where(and(eq(leads.runId, RUN_ID), isNull(leads.removedAt), sql`${leads.preflightStatus} = 'ok'`))
    .orderBy(asc(leads.rowIndex))
    .limit(50);
  let chosen: { leadId: string; substitutions: Record<string, string> } | null = null;
  for (const lead of rows) {
    const r = resolveIntroSubstitutions(template, (lead.data ?? {}) as Record<string, string>);
    if (r.ok) {
      chosen = { leadId: lead.id, substitutions: r.substitutions };
      break;
    }
  }
  if (!chosen) throw new Error("kein Lead mit brauchbaren Namensdaten");
  const displayName =
    chosen.substitutions.vorname ??
    [chosen.substitutions.anrede, chosen.substitutions.nachname].filter(Boolean).join(" ");
  console.log(`[ab] Lead: ${displayName} (${chosen.leadId})`);

  const workDir = await mkdtemp(join(tmpdir(), "intro-ab-"));
  try {
    const referer = process.env.APP_URL ?? "https://app.videocomet.de";
    const res = await fetch(row.webcamUrl, {
      headers: { Referer: referer, Origin: referer, "User-Agent": "videocomet-worker/1.0" },
    });
    if (!res.ok) throw new Error(`webcam download HTTP ${res.status}`);
    const webcamLocalPath = join(workDir, "webcam-src.mp4");
    await writeFile(webcamLocalPath, Buffer.from(await res.arrayBuffer()));

    // ElevenLabs-Clone aus DERSELBEN Tonspur wie die Kampagnen-Stimme.
    const elSamplePath = join(workDir, "el-sample.mp3");
    await runFfmpeg([
      "-y", "-i", webcamLocalPath, "-vn", "-ac", "1", "-ar", "44100",
      "-t", "260", "-b:a", "96k", elSamplePath,
    ]);
    const elVoiceId = await elCreateVoice(elSamplePath);
    console.log(`[ab] ElevenLabs-Voice: ${elVoiceId}`);

    const stamp = Date.now().toString(36);
    const results: Array<{ label: string; url: string }> = [];
    for (const variant of ["fish", "elevenlabs"] as const) {
      const dir = join(workDir, variant);
      await mkdir(dir, { recursive: true });
      console.log(`[ab] rendere ${variant}...`);
      const result = await generatePersonalizedWebcam({
        userId: row.userId,
        tag: `ab-${variant}`,
        substitutions: chosen.substitutions,
        calibration,
        fishModelId: calibration.voiceFishModelId,
        webcamLocalPath,
        workDir: dir,
        trimToSec: TRIM_TO_SEC,
        ...(variant === "elevenlabs"
          ? { ttsOverride: (text: string) => elTts(elVoiceId, text) }
          : {}),
      });
      if (!result.ok) {
        console.error(`[ab] ${variant} FEHLGESCHLAGEN: ${result.reason}`);
        continue;
      }
      const up = await uploadFile({
        buffer: await readFile(result.outputPath),
        remotePath: `voice-ab/${stamp}/${variant}-${displayName.toLowerCase()}.mp4`,
        contentType: "video/mp4",
      });
      results.push({ label: variant, url: up.url });
      console.log(`[ab] ${variant}: ${up.url}`);
    }

    console.log("\n[ab] fertig:");
    for (const r of results) console.log(`  ${r.label}: ${r.url}`);
    console.log(`  (ElevenLabs-Voice ${elVoiceId} danach manuell löschen)`);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("[ab] fatal:", err);
  process.exit(1);
});
