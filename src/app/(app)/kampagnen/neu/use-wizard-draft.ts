"use client";

import * as React from "react";
import type { WizardState } from "./wizard-container";

/**
 * Hook: useWizardDraft
 *
 * Persistiert den Kampagnen-Wizard-State debounced (600 ms) in `localStorage`,
 * scoped pro User-Account. Damit überlebt der Fortschritt sowohl reine
 * Navigationen (`/landingpages/neu` → Browser-Back) als auch das vollständige
 * Schließen des Tabs.
 *
 * Strategie:
 *   - Key: `vc:wizard:draft:<userId>` — User-Scope verhindert, dass auf
 *     geteilten Geräten Drafts zwischen Accounts „durchsickern".
 *   - Speicherform: JSON-Payload mit `version`, `state`, `step`, `savedAt`.
 *     Beim Restore wird via `safeParse` validiert; bei Schema-Drift wird der
 *     Entwurf verworfen und ein Toast-Hint zurückgegeben.
 *   - Quota-Fallback: bei `QuotaExceededError` versuchen wir es in
 *     `sessionStorage` erneut. Schlägt auch das fehl → Status „error".
 *   - Multi-Tab: bei jedem Mount wird der zuletzt geschriebene Wert gelesen
 *     (kein Merge). Ist `savedAt` eines anderen Tabs neuer als unser Mount,
 *     übernehmen wir das im `storage`-Event.
 *
 * Wir verzichten bewusst auf serverside Drafts: der Wizard wird selten
 * stundenlang offen gelassen, und ein DB-Schema-Eintrag würde Listen-Filter
 * (`is_draft = false`) an mehreren Stellen erfordern. localStorage ist
 * deutlich risikoärmer und deckt 100 % des hier diskutierten Use-Cases ab.
 */

// v2: Intro-Schritt eingefügt — Step-Indizes alter Drafts passen nicht mehr.
const STORAGE_VERSION = 2;
const DEBOUNCE_MS = 600;

export type DraftSaveStatus = "idle" | "saving" | "saved" | "error";

export interface DraftEnvelope {
  version: number;
  /** ISO timestamp, gesetzt beim Schreiben. */
  savedAt: string;
  /** Wizard-State, bei Restore mit `safeParse` geprüft. */
  state: WizardState;
  /** Step, an dem der Nutzer zuletzt war (0-basiert). */
  step: number;
}

export interface UseWizardDraftOptions {
  /** User-ID — gibt den Scope für den localStorage-Key vor. */
  userId: string;
  /** Aktueller Wizard-State (wird debounced gespeichert). */
  state: WizardState;
  /** Aktueller Step. */
  step: number;
}

export interface UseWizardDraftResult {
  /** Status der letzten Auto-Save-Operation — für die UI-Pille. */
  status: DraftSaveStatus;
  /** Wann zuletzt erfolgreich gespeichert wurde (ISO). */
  lastSavedAt: string | null;
  /**
   * Existiert ein Draft, der NICHT zum aktuellen Mount gehört (d. h. der
   * Nutzer hatte einen vorherigen Wizard angefangen)? Wenn ja, liefern wir
   * den Envelope für das Banner zurück; sonst `null`.
   */
  existingDraft: DraftEnvelope | null;
  /** „Fortsetzen": State + Step zurückspielen, Banner schließen. */
  restoreDraft: () => void;
  /** „Verwerfen": Draft löschen, Banner schließen. */
  discardDraft: () => void;
  /**
   * Auf erfolgreichen Final-Save aufzurufen — räumt den Draft auf, damit der
   * Nutzer beim nächsten Wizard-Besuch keinen veralteten Entwurf vorfindet.
   */
  clearDraft: () => void;
}

interface UseWizardDraftIO {
  setState: (s: WizardState) => void;
  setStep: (s: number) => void;
}

function storageKey(userId: string): string {
  return `vc:wizard:draft:${userId}`;
}

// ── State-Validierung beim Restore ────────────────────────────────────────────
//
// Wir prüfen nur die Top-Level-Form (alle erwarteten Keys, primitive Typen).
// Die Segment-Inhalte sind zu umfangreich, um sie hier 1:1 nachzubauen — wir
// vertrauen darauf, dass der Editor mit seinen eigenen Validierungen umgeht
// und nehmen Arrays als „mutmaßlich gültig" entgegen. Falls Felder fehlen,
// wird der Draft verworfen.

function isWizardState(value: unknown): value is WizardState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const baseOk =
    typeof v.name === "string" &&
    (v.webcamMediaId === null || typeof v.webcamMediaId === "string") &&
    (v.mode === "webcam-only" || v.mode === "with-presentation") &&
    Array.isArray(v.segments) &&
    (v.pipPosition === "bottom-left" || v.pipPosition === "bottom-right") &&
    (v.pipShape === "square" ||
      v.pipShape === "rounded" ||
      v.pipShape === "circle") &&
    (v.landingPageTemplateId === null ||
      typeof v.landingPageTemplateId === "string") &&
    (v.customLpTemplateId === null ||
      typeof v.customLpTemplateId === "string") &&
    (v.domainId === null || typeof v.domainId === "string") &&
    (v.slugTemplate === null || typeof v.slugTemplate === "string") &&
    typeof v.pdfEnabled === "boolean" &&
    typeof v.pdfGoogleDocsUrl === "string" &&
    typeof v.pdfQrEnabled === "boolean" &&
    typeof v.pdfThumbnailEnabled === "boolean" &&
    (v.pdfThumbnailFrameMs === null ||
      typeof v.pdfThumbnailFrameMs === "number");
  if (!baseOk) return false;
  // Paket-C-Felder: optional für Forward/Backward-Compat. Alte Drafts
  // ohne diese Keys werden akzeptiert; beim Restore fallen wir in der
  // Container-Komponente auf die Default-Initialwerte zurück.
  const thumbEnabledOk =
    v.thumbnailImageEnabled === undefined ||
    typeof v.thumbnailImageEnabled === "boolean";
  const thumbImgOk =
    v.thumbnailImage === undefined ||
    v.thumbnailImage === null ||
    (typeof v.thumbnailImage === "object" && v.thumbnailImage !== null);
  // Migration-0019-Felder: ebenfalls optional, damit Drafts aus der
  // Vor-Paket-A-Zeit weiterhin restoren — der Migrate-Pfad in
  // `restoreDraft` füllt die Defaults nach.
  const modeOk =
    v.thumbnailMode === undefined ||
    v.thumbnailMode === "frame" ||
    v.thumbnailMode === "custom_image" ||
    v.thumbnailMode === "landingpage_screenshot";
  const playIconOk =
    v.thumbnailPlayIcon === undefined ||
    typeof v.thumbnailPlayIcon === "boolean";
  return thumbEnabledOk && thumbImgOk && modeOk && playIconOk;
}

function isEnvelope(value: unknown): value is DraftEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "number" &&
    v.version === STORAGE_VERSION &&
    typeof v.savedAt === "string" &&
    typeof v.step === "number" &&
    isWizardState(v.state)
  );
}

function readDraft(userId: string): DraftEnvelope | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem(storageKey(userId)) ??
      window.sessionStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope(parsed)) {
      // Schema-Drift → aufräumen.
      window.localStorage.removeItem(storageKey(userId));
      window.sessionStorage.removeItem(storageKey(userId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isDefaultState(state: WizardState): boolean {
  // „Frischer" Wizard-Mount — kein erwähnenswerter Fortschritt. Wir
  // verzichten dann auf das Schreiben, damit ein Discard-Banner-Klick
  // den localStorage nicht sofort wieder mit dem leeren Initial-State
  // beschreibt.
  return (
    state.name === "" &&
    state.webcamMediaId === null &&
    state.segments.length === 0 &&
    state.landingPageTemplateId === null &&
    state.customLpTemplateId === null &&
    state.domainId === null &&
    state.slugTemplate === null &&
    !state.pdfEnabled &&
    state.pdfGoogleDocsUrl === "" &&
    !state.pdfQrEnabled &&
    !state.pdfThumbnailEnabled &&
    state.pdfThumbnailFrameMs === null &&
    !state.thumbnailImageEnabled &&
    state.thumbnailImage === null &&
    state.thumbnailMode === "frame" &&
    !state.thumbnailPlayIcon &&
    !state.introEnabled
  );
}

export function useWizardDraft(
  { userId, state, step }: UseWizardDraftOptions,
  io: UseWizardDraftIO,
): UseWizardDraftResult {
  const [status, setStatus] = React.useState<DraftSaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(null);
  const [existingDraft, setExistingDraft] = React.useState<DraftEnvelope | null>(
    null,
  );

  // Auf Mount: existiert ein älterer Entwurf? Banner zeigen.
  React.useEffect(() => {
    const draft = readDraft(userId);
    if (draft) {
      setExistingDraft(draft);
      setLastSavedAt(draft.savedAt);
    }
    // ESLint: nur einmal beim Mount lesen — userId ändert sich im
    // Wizard nicht.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Discard-Marker ────────────────────────────────────────────────────────
  //
  // Nach „Verwerfen" soll der Auto-Save NICHT sofort wieder den (jetzt
  // leeren, aber existierenden) State zurückschreiben. Wir setzen ein Flag
  // bis sich der State tatsächlich vom Default-State entfernt.
  const suppressUntilDirtyRef = React.useRef(false);

  // Banner: Fortsetzen
  const restoreDraft = React.useCallback(() => {
    if (!existingDraft) return;
    // Forward-Compat: alte Drafts (vor Paket C) hatten keine thumbnail-
    // Felder. Wir füllen sie defensiv mit Defaults, sonst greift `undefined`
    // bis in den Editor durch. Migration-0019-Felder ebenfalls defaults:
    // Drafts vor Paket A kennen `thumbnailMode`/`thumbnailPlayIcon` nicht,
    // wir mappen Bestands-`thumbnailImageEnabled=true` auf 'custom_image',
    // sonst 'frame' — analog zum SQL-Backfill der Migration.
    const prev = existingDraft.state as WizardState & {
      thumbnailMode?: WizardState["thumbnailMode"];
      thumbnailPlayIcon?: boolean;
      abTestingEnabled?: boolean;
      pdfGoogleDocsUrlB?: string;
      abSplitMode?: WizardState["abSplitMode"];
      abSplitWeightA?: number;
      introEnabled?: boolean;
    };
    const fallbackMode: WizardState["thumbnailMode"] = prev.thumbnailImageEnabled
      ? "custom_image"
      : "frame";
    const migrated: WizardState = {
      ...existingDraft.state,
      thumbnailImageEnabled: prev.thumbnailImageEnabled ?? false,
      thumbnailImage: prev.thumbnailImage ?? null,
      thumbnailMode: prev.thumbnailMode ?? fallbackMode,
      thumbnailPlayIcon: prev.thumbnailPlayIcon ?? false,
      abTestingEnabled: prev.abTestingEnabled ?? false,
      pdfGoogleDocsUrlB: prev.pdfGoogleDocsUrlB ?? "",
      abSplitMode: prev.abSplitMode ?? "random",
      abSplitWeightA: prev.abSplitWeightA ?? 50,
      introEnabled: prev.introEnabled ?? false,
    };
    io.setState(migrated);
    io.setStep(existingDraft.step);
    setExistingDraft(null);
    setStatus("saved");
  }, [existingDraft, io]);

  // Banner: Verwerfen
  const discardDraft = React.useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKey(userId));
        window.sessionStorage.removeItem(storageKey(userId));
      } catch {
        // graceful no-op
      }
    }
    setExistingDraft(null);
    setLastSavedAt(null);
    setStatus("idle");
    suppressUntilDirtyRef.current = true;
  }, [userId]);

  // Nach Final-Save aufrufen
  const clearDraft = React.useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKey(userId));
        window.sessionStorage.removeItem(storageKey(userId));
      } catch {
        // graceful no-op
      }
    }
    setExistingDraft(null);
    setStatus("idle");
    setLastSavedAt(null);
  }, [userId]);

  // ── Debounced Auto-Save ───────────────────────────────────────────────────
  //
  // Wir speichern nur den „nutzbaren" State (keine defaults), und nur, wenn
  // a) Banner nicht offen ist (Banner = es liegt noch ein anderer Entwurf
  //    rum, den der Nutzer entscheiden muss) und
  // b) der State von den Defaults abweicht.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (existingDraft) return; // Erst entscheiden lassen
    const isFresh = isDefaultState(state);
    if (suppressUntilDirtyRef.current) {
      if (isFresh) return;
      suppressUntilDirtyRef.current = false;
    }
    if (isFresh && lastSavedAt === null) return;

    // WICHTIG: status NICHT hier (synchron beim Re-Render) auf "saving"
    // setzen — wir setzen es erst INNERHALB des Timeouts. Sonst flackert
    // die Pille bei jedem Tastenanschlag auf "Speichere…" und bleibt
    // dauerhaft hängen, solange der User aktiv tippt (cleanup cancelt
    // den Timeout vor dem tatsächlichen Save).
    const handle = window.setTimeout(() => {
      setStatus("saving");
      const envelope: DraftEnvelope = {
        version: STORAGE_VERSION,
        savedAt: new Date().toISOString(),
        state,
        step,
      };
      const payload = JSON.stringify(envelope);
      try {
        window.localStorage.setItem(storageKey(userId), payload);
        setLastSavedAt(envelope.savedAt);
        setStatus("saved");
      } catch {
        // Quota voll → sessionStorage versuchen.
        try {
          window.sessionStorage.setItem(storageKey(userId), payload);
          setLastSavedAt(envelope.savedAt);
          setStatus("saved");
        } catch {
          setStatus("error");
        }
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [state, step, userId, existingDraft, lastSavedAt]);

  // Multi-Tab: anderer Tab schreibt → unseren `lastSavedAt` syncen, damit
  // die Pille die Wahrheit widerspiegelt. Wir spielen den State NICHT in
  // unseren Wizard zurück (würde User-Input überschreiben).
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId)) return;
      if (!e.newValue) {
        setLastSavedAt(null);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(e.newValue);
        if (isEnvelope(parsed)) {
          setLastSavedAt(parsed.savedAt);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  return {
    status,
    lastSavedAt,
    existingDraft,
    restoreDraft,
    discardDraft,
    clearDraft,
  };
}
