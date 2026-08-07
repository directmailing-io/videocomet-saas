/**
 * Fish Audio API-Client (Voice-Clone + TTS + ASR).
 *
 * Base: https://api.fish.audio
 * Auth: `Authorization: Bearer <FISH_AUDIO_API_KEY>`
 *
 * Verwendet vom Voice-Training-Worker (Model-Erstellung), vom Intro-
 * Renderer (TTS pro Lead, Phase 2) und von der Revoke-Route (Model-
 * Löschung). TTS-Modell ist fix `s2.1-pro` (Blind-Test-Sieger, siehe
 * intro-poc).
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const FISH_API_BASE = "https://api.fish.audio";

/** Fish-Limit: max. Gesamtmaterial pro Voice-Model in Sekunden. */
export const FISH_MAX_TRAINING_SECONDS = 270;

export const FISH_TTS_MODEL = "s2.1-pro";

function apiKey(): string {
  const key = process.env.FISH_AUDIO_API_KEY;
  if (!key) throw new Error("FISH_AUDIO_API_KEY is required");
  return key;
}

/**
 * HTTP-Fehler, den der Caller unterscheiden kann:
 *   - `retryable=true` bei 429 (Rate-Limit) und 5xx (Server-Fehler bei Fish)
 *     → BullMQ-Retry sollte greifen statt sofort in Fallback zu gehen.
 *   - `retryable=false` bei 4xx (Client-Fehler, unser Bug oder ungültige Daten).
 */
export class FishAudioError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(status: number, context: string, detail: string) {
    super(`[fish-audio] ${context} failed: HTTP ${status} ${detail}`);
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

async function assertOk(res: Response, context: string): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    // ignore
  }
  throw new FishAudioError(res.status, context, detail);
}

export interface CreateVoiceModelInput {
  title: string;
  audioFilePaths: string[];
  /**
   * Gesamtdauer des Materials in Sekunden, falls bekannt. Fish erlaubt
   * max. 270s — Caller (voice-training worker) trimmt vorher; hier nur
   * ein letzter Guard gegen versehentliche Über-Uploads.
   */
  totalDurationSec?: number;
}

export interface CreateVoiceModelResult {
  _id: string;
}

export async function createVoiceModel(
  input: CreateVoiceModelInput,
): Promise<CreateVoiceModelResult> {
  if (
    input.totalDurationSec !== undefined &&
    input.totalDurationSec > FISH_MAX_TRAINING_SECONDS
  ) {
    throw new Error(
      `[fish-audio] training material too long: ${input.totalDurationSec}s > ${FISH_MAX_TRAINING_SECONDS}s`,
    );
  }
  const form = new FormData();
  form.append("title", input.title);
  form.append("type", "tts");
  form.append("train_mode", "fast");
  form.append("visibility", "private");
  for (const path of input.audioFilePaths) {
    const buffer = await readFile(path);
    form.append(
      "voices",
      new Blob([new Uint8Array(buffer)], { type: "application/octet-stream" }),
      basename(path),
    );
  }

  const res = await fetch(`${FISH_API_BASE}/model`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  await assertOk(res, "createVoiceModel");
  const json = (await res.json()) as { _id?: string };
  if (!json._id) {
    throw new Error("[fish-audio] createVoiceModel: response missing _id");
  }
  return { _id: json._id };
}

/** DELETE https://api.fish.audio/model/{id} (verifiziert via docs.fish.audio). */
export async function deleteVoiceModel(id: string): Promise<void> {
  const res = await fetch(`${FISH_API_BASE}/model/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  // 404 = schon weg — für den Revoke-Pfad ok.
  if (res.status === 404) return;
  await assertOk(res, "deleteVoiceModel");
}

export interface TtsInput {
  text: string;
  /** Fish-Model-ID (voice_profiles.fishModelId). */
  referenceId: string;
  /** Sampling-Randomness 0..1 (Fish-Default 0.7). */
  temperature?: number;
  /** Nucleus-Sampling 0..1 (Fish-Default 0.7). */
  topP?: number;
  /**
   * Sprechtempo 0.5–2.0 via Fish `prosody.speed` — klingt natürlicher
   * als nachträgliches ffmpeg-atempo (kein Resampling-Artefakt).
   */
  speed?: number;
}

/**
 * Retry bei 429/5xx: Best-of-N-Kandidaten × parallele Preview-Leads
 * überschreiten schnell das Fish-Concurrency-Limit — mit Backoff lösen
 * sich die Kollisionen auf, statt dass der Lead scheitert.
 */
const TTS_RETRY_ATTEMPTS = 5;
const TTS_RETRY_BASE_MS = 3_000;

/** Synthetisiert `text` mit dem Voice-Clone; liefert WAV-Bytes. */
export async function tts(input: TtsInput): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${FISH_API_BASE}/v1/tts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
          model: FISH_TTS_MODEL,
        },
        body: JSON.stringify({
          text: input.text,
          reference_id: input.referenceId,
          format: "wav",
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.topP !== undefined ? { top_p: input.topP } : {}),
          ...(input.speed !== undefined ? { prosody: { speed: input.speed } } : {}),
        }),
      });
      await assertOk(res, "tts");
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      const retryable =
        err instanceof FishAudioError && err.retryable && attempt < TTS_RETRY_ATTEMPTS;
      if (!retryable) throw err;
      const delayMs =
        TTS_RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 1_000;
      console.warn(
        `[fish-audio] tts retry ${attempt}/${TTS_RETRY_ATTEMPTS - 1} in ${Math.round(delayMs)}ms: ${(err as Error).message.slice(0, 120)}`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export interface AsrSegment {
  text: string;
  start: number;
  end: number;
}

export interface AsrResult {
  text: string;
  duration: number;
  segments: AsrSegment[];
}

/**
 * Speech-to-Text (POST /v1/asr, multipart). Liefert `null` statt zu werfen,
 * wenn der Call fehlschlägt — die Kalibrierung fällt dann auf die reine
 * Silence-Heuristik zurück (transcript_sentence bleibt NULL).
 */
export async function asr(input: {
  audioPath: string;
  language?: string;
}): Promise<AsrResult | null> {
  try {
    const buffer = await readFile(input.audioPath);
    const form = new FormData();
    form.append(
      "audio",
      new Blob([new Uint8Array(buffer)], { type: "application/octet-stream" }),
      basename(input.audioPath),
    );
    form.append("language", input.language ?? "de");
    form.append("ignore_timestamps", "false");
    const res = await fetch(`${FISH_API_BASE}/v1/asr`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
    });
    if (!res.ok) {
      console.warn(`[fish-audio] asr failed: HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as Partial<AsrResult>;
    if (typeof json.text !== "string") return null;
    return {
      text: json.text,
      duration: Number(json.duration ?? 0),
      segments: Array.isArray(json.segments)
        ? json.segments.map((s) => ({
            text: String(s.text ?? ""),
            start: Number(s.start ?? 0),
            end: Number(s.end ?? 0),
          }))
        : [],
    };
  } catch (err) {
    console.warn("[fish-audio] asr error:", (err as Error).message);
    return null;
  }
}

export interface FishCredit {
  credit: number;
}

export async function getCredit(): Promise<FishCredit> {
  const res = await fetch(`${FISH_API_BASE}/wallet/self/api-credit`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  await assertOk(res, "getCredit");
  const json = (await res.json()) as { credit?: number | string };
  return { credit: Number(json.credit ?? 0) };
}
