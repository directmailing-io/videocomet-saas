"use client";

import * as React from "react";
import type { WizardState } from "./wizard-container";

/**
 * Hook: useWizardDraft — Server-Drafts (Migration 0052)
 *
 * Persistiert den Kampagnen-Wizard-State debounced als echte
 * Kampagnen-Row mit `status='draft'`:
 *
 *   - Beim ERSTEN echten Fortschritt (State weicht von den Defaults ab)
 *     legt der Hook per POST /api/campaigns { draft: true } die Row an.
 *     Dadurch entsteht sofort eine „Entwurf"-Card in der Übersicht —
 *     aber keine leere Karteileiche, wenn jemand den Wizard nur öffnet.
 *   - Danach schreibt jeder Auto-Save per PATCH den kompletten
 *     Wizard-Snapshot ({ version, step, state }) in `wizard_state` +
 *     den Namen (für die Card). So sind auch Felder ohne eigene
 *     campaigns-Spalte (KI-Begrüßungs-Prefix, Thumbnail-Folie, …)
 *     verlustfrei wiederherstellbar.
 *   - Nach dem Anlegen wird die URL still auf `?draft=<id>` gesetzt,
 *     damit ein Reload denselben Entwurf weiterführt.
 *   - Mehrere Entwürfe parallel: jeder Wizard-Besuch ohne `?draft=`
 *     erzeugt beim ersten Fortschritt einen neuen.
 *
 * Legacy: Vor Migration 0052 lagen Drafts nur in localStorage
 * (`vc:wizard:draft:<userId>`). Existiert dort noch ein Entwurf, zeigen
 * wir weiterhin das Restore-Banner; „Fortsetzen" spielt ihn in den
 * Wizard zurück (der Auto-Save migriert ihn dann automatisch zum
 * Server-Draft) und räumt den localStorage-Key auf.
 */

// v2: Intro-Schritt eingefügt — Step-Indizes alter Drafts passen nicht mehr.
// v3: Step-Reihenfolge geändert (KI-Begrüßung ist jetzt Step 1 direkt nach
//     Webcam) — Step-Indizes alter Drafts verweisen auf falsche Screens.
// v4: Wizard-State bekommt introGreetingPrefix + introNamePattern; ohne
//     die Felder crasht die Wizard-Karte „KI-Begrüßung".
const STORAGE_VERSION = 4;
const DEBOUNCE_MS = 900;

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
  /** User-ID — Scope für den Legacy-localStorage-Key. */
  userId: string;
  /** Server-Draft-ID aus `?draft=` — null bei frischem Wizard. */
  initialDraftId: string | null;
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
  /** ID der Server-Draft-Row (null solange noch nichts angelegt wurde). */
  draftId: string | null;
  /** Legacy-localStorage-Entwurf für das Restore-Banner; sonst null. */
  existingDraft: DraftEnvelope | null;
  /** „Fortsetzen": State + Step zurückspielen, Banner schließen. */
  restoreDraft: () => void;
  /** „Verwerfen": Legacy-Draft löschen, Banner schließen. */
  discardDraft: () => void;
  /** Nach erfolgreicher Aktivierung aufzurufen — räumt Legacy-Keys auf. */
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
  // ohne diese Keys werden akzeptiert; beim Restore fallen wir auf die
  // Default-Initialwerte zurück.
  const thumbEnabledOk =
    v.thumbnailImageEnabled === undefined ||
    typeof v.thumbnailImageEnabled === "boolean";
  const thumbImgOk =
    v.thumbnailImage === undefined ||
    v.thumbnailImage === null ||
    (typeof v.thumbnailImage === "object" && v.thumbnailImage !== null);
  // Migration-0019-Felder: ebenfalls optional, damit Drafts aus der
  // Vor-Paket-A-Zeit weiterhin restoren — der Migrate-Pfad füllt die
  // Defaults nach.
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

/**
 * Fehlende optionale Felder mit Defaults nachfüllen (Forward-Compat für
 * Drafts aus älteren Wizard-Versionen) — gemeinsam genutzt vom Legacy-
 * Restore und vom Server-Draft-Resume.
 */
function migrateWizardState(state: WizardState): WizardState {
  const prev = state as WizardState & {
    thumbnailMode?: WizardState["thumbnailMode"];
    thumbnailPlayIcon?: boolean;
    abTestingEnabled?: boolean;
    pdfGoogleDocsUrlB?: string;
    abSplitMode?: WizardState["abSplitMode"];
    abSplitWeightA?: number;
    introEnabled?: boolean;
    introGreetingPrefix?: WizardState["introGreetingPrefix"];
    introNamePattern?: WizardState["introNamePattern"];
  };
  const fallbackMode: WizardState["thumbnailMode"] = prev.thumbnailImageEnabled
    ? "custom_image"
    : "frame";
  return {
    ...state,
    thumbnailImageEnabled: prev.thumbnailImageEnabled ?? false,
    thumbnailImage: prev.thumbnailImage ?? null,
    thumbnailMode: prev.thumbnailMode ?? fallbackMode,
    thumbnailPlayIcon: prev.thumbnailPlayIcon ?? false,
    abTestingEnabled: prev.abTestingEnabled ?? false,
    pdfGoogleDocsUrlB: prev.pdfGoogleDocsUrlB ?? "",
    abSplitMode: prev.abSplitMode ?? "random",
    abSplitWeightA: prev.abSplitWeightA ?? 50,
    introEnabled: prev.introEnabled ?? false,
    introGreetingPrefix: prev.introGreetingPrefix ?? "Hi",
    introNamePattern: prev.introNamePattern ?? "firstName",
  };
}

/**
 * Server-seitig gespeicherten `wizard_state`-Snapshot validieren und
 * migrieren. Liefert null bei Schema-Drift — der Wizard startet dann
 * frisch, behält aber die Draft-ID (der nächste Auto-Save überschreibt
 * den kaputten Snapshot).
 */
export function parseDraftEnvelope(
  raw: unknown,
): { state: WizardState; step: number } | null {
  if (!isEnvelope(raw)) return null;
  return { state: migrateWizardState(raw.state), step: raw.step };
}

/** Anzeigename für die Entwurfs-Card, solange noch kein Name vergeben ist. */
export function draftDisplayName(state: WizardState): string {
  return state.name.trim() || "Unbenannter Entwurf";
}

function readLegacyDraft(userId: string): DraftEnvelope | null {
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

function removeLegacyDraft(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(userId));
    window.sessionStorage.removeItem(storageKey(userId));
  } catch {
    // graceful no-op
  }
}

function isDefaultState(state: WizardState): boolean {
  // „Frischer" Wizard-Mount — kein erwähnenswerter Fortschritt. Solange
  // der State den Defaults entspricht, legen wir KEINE Draft-Row an.
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
  { userId, initialDraftId, state, step }: UseWizardDraftOptions,
  io: UseWizardDraftIO,
): UseWizardDraftResult {
  const [status, setStatus] = React.useState<DraftSaveStatus>(
    initialDraftId ? "saved" : "idle",
  );
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(null);
  const [draftId, setDraftId] = React.useState<string | null>(initialDraftId);
  const [existingDraft, setExistingDraft] = React.useState<DraftEnvelope | null>(
    null,
  );

  // Immer der frischeste Stand — der Save liest hieraus, damit auch bei
  // in-flight Requests nie ein veralteter Snapshot geschrieben wird.
  const latestRef = React.useRef({ state, step });
  latestRef.current = { state, step };

  const draftIdRef = React.useRef<string | null>(initialDraftId);
  const savingRef = React.useRef(false);
  const dirtyAgainRef = React.useRef(false);

  // Auf Mount: Legacy-localStorage-Entwurf? Banner zeigen — aber nur,
  // wenn wir nicht ohnehin einen Server-Draft fortsetzen.
  React.useEffect(() => {
    if (initialDraftId) return;
    const draft = readLegacyDraft(userId);
    if (draft) setExistingDraft(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = React.useCallback(async () => {
    if (savingRef.current) {
      dirtyAgainRef.current = true;
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    try {
      const { state: s, step: st } = latestRef.current;
      const envelope: DraftEnvelope = {
        version: STORAGE_VERSION,
        savedAt: new Date().toISOString(),
        state: s,
        step: st,
      };
      const name = draftDisplayName(s);
      let res: Response;
      if (!draftIdRef.current) {
        res = await fetch("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draft: true,
            name,
            mode: s.mode,
            introEnabled: s.introEnabled,
            pdfEnabled: s.pdfEnabled,
            wizardState: envelope,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { campaign?: { id: string } };
          if (data.campaign?.id) {
            draftIdRef.current = data.campaign.id;
            setDraftId(data.campaign.id);
            // Reload/Back soll denselben Entwurf weiterführen.
            window.history.replaceState(
              null,
              "",
              `/kampagnen/neu?draft=${data.campaign.id}`,
            );
          }
        }
      } else {
        res = await fetch(`/api/campaigns/${draftIdRef.current}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            // Diese Spalten spiegeln wir mit, damit die Entwurfs-Card
            // in der Übersicht die richtigen Feature-Chips zeigt.
            mode: s.mode,
            introEnabled: s.introEnabled,
            pdfEnabled: s.pdfEnabled,
            wizardState: envelope,
          }),
        });
      }
      if (res.ok) {
        setLastSavedAt(envelope.savedAt);
        setStatus("saved");
        // Ab jetzt ist der Server die Wahrheit — Legacy-Key entsorgen,
        // damit beim nächsten Wizard-Besuch kein veraltetes Banner kommt.
        removeLegacyDraft(userId);
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      savingRef.current = false;
      if (dirtyAgainRef.current) {
        dirtyAgainRef.current = false;
        void flush();
      }
    }
  }, [userId]);

  // Banner: Fortsetzen (Legacy-localStorage → Wizard; der Auto-Save
  // migriert den Stand danach automatisch zum Server-Draft).
  const restoreDraft = React.useCallback(() => {
    if (!existingDraft) return;
    io.setState(migrateWizardState(existingDraft.state));
    io.setStep(existingDraft.step);
    setExistingDraft(null);
    removeLegacyDraft(userId);
  }, [existingDraft, io, userId]);

  // Banner: Verwerfen
  const discardDraft = React.useCallback(() => {
    removeLegacyDraft(userId);
    setExistingDraft(null);
  }, [userId]);

  // Nach erfolgreicher Aktivierung aufrufen.
  const clearDraft = React.useCallback(() => {
    removeLegacyDraft(userId);
    draftIdRef.current = null;
    setDraftId(null);
    setStatus("idle");
    setLastSavedAt(null);
  }, [userId]);

  // ── Debounced Auto-Save ───────────────────────────────────────────────────
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (existingDraft) return; // Erst über den Legacy-Draft entscheiden lassen
    // Ohne Draft-Row legen wir erst bei echtem Fortschritt an; MIT
    // Draft-Row speichern wir jede Änderung (auch zurück auf Defaults).
    if (!draftIdRef.current && isDefaultState(state)) return;

    const handle = window.setTimeout(() => {
      void flush();
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [state, step, existingDraft, flush]);

  return {
    status,
    lastSavedAt,
    draftId,
    existingDraft,
    restoreDraft,
    discardDraft,
    clearDraft,
  };
}
