"use client";

/**
 * Local editor state + auto-save + undo stack for the block-based
 * Landing-Page editor.
 *
 * Design notes:
 *   - All edits flow through `mutate()` which pushes the *previous* snapshot
 *     onto an undo stack. The stack is capped at MAX_UNDO so memory stays
 *     bounded even for hyper-active editing sessions.
 *   - Auto-save is debounced 800 ms and compares the serialised snapshot to
 *     the last persisted snapshot, so identical re-edits don't trip a PATCH.
 *   - `name` is persisted independently (on blur from the title input) so we
 *     don't ship every keystroke of the title in the auto-save body.
 */

import * as React from "react";

import { migrateLegacyContent } from "@/lib/landing-blocks/migrate";
import type {
  Block,
  BlockType,
  LandingContentV2,
} from "@/lib/landing-blocks/types";
import type {
  BrandConfig,
  ThemeConfig,
} from "@/lib/landing-theme/types";
import { DEFAULT_BRAND, DEFAULT_THEME } from "@/lib/landing-theme/types";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface PersistedContent extends LandingContentV2 {
  /** Theme tokens — Agent B's `ThemeConfig`. */
  theme: ThemeConfig & Record<string, unknown>;
  /** Brand tokens — Agent B's `BrandConfig`. Optional in v2 envelope. */
  brand?: BrandConfig;
}

export interface LpEditorInitialTemplate {
  id: string;
  name: string;
  /** Legacy column on the row — sent back on PATCH for back-compat. */
  themeId: string;
  /** Raw JSONB — may be v1 or v2. */
  content: Record<string, unknown>;
}

export interface LpEditorSnapshot {
  blocks: Block[];
  theme: ThemeConfig;
  brand: BrandConfig;
}

/** Bounded undo stack size — covers ~20 deliberate edits. */
const MAX_UNDO = 20;
/** Debounce window for auto-save. Matches the legacy editor's UX. */
const DEBOUNCE_MS = 800;

function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build a Block with sensible defaults for the given type. Used by the
 * "+ Block hinzufügen" action so newly inserted blocks aren't empty.
 */
export function makeDefaultBlock(type: BlockType): Block {
  switch (type) {
    case "hero":
      return {
        id: genId("hero"),
        type,
        data: {
          headline: "{{firstName|Hallo}}, schön, dass Sie hier sind",
          subheadline: "",
          alignment: "center",
          showVideo: true,
        },
      };
    case "about-me":
      return {
        id: genId("about"),
        type,
        data: { name: "", role: "", bio: "", portraitUrl: "" },
      };
    case "testimonials":
      return {
        id: genId("testi"),
        type,
        data: {
          items: [{ quote: "", author: "", role: "", avatar: "" }],
        },
      };
    case "logos-cloud":
      return {
        id: genId("logos"),
        type,
        data: { title: "Vertraut von", items: [] },
      };
    case "stats":
      return {
        id: genId("stats"),
        type,
        data: { items: [{ value: "100+", label: "Kunden" }] },
      };
    case "faq":
      return {
        id: genId("faq"),
        type,
        data: { items: [{ q: "", a: "" }] },
      };
    case "rich-text":
      return { id: genId("rich"), type, data: { markdown: "" } };
    case "cta-banner":
      return {
        id: genId("cta"),
        type,
        data: {
          headline: "Bereit für den nächsten Schritt?",
          subheadline: "",
          primaryButton: { label: "Termin buchen", url: "" },
          secondaryButton: { label: "", url: "" },
        },
      };
    case "case-study":
      return {
        id: genId("case"),
        type,
        variant: "media-left",
        data: {
          headline: "So haben wir Kunden geholfen",
          client: { name: "Beispiel GmbH", logoUrl: "", photoUrl: "" },
          medium: { kind: "image", url: "", alt: "" },
          textMode: "structured",
          quote: { text: "", author: "", role: "" },
          freeText: "",
          structured: { situation: "", action: "", result: "", kpi: "" },
        },
      };
    case "content":
      return {
        id: genId("content"),
        type,
        variant: "media-left",
        data: { headline: "", body: "", image: { url: "", alt: "" } },
      };
    case "image":
      return {
        id: genId("img"),
        type,
        data: { url: "", alt: "", caption: "", fullWidth: false },
      };
    case "spacer":
      return { id: genId("space"), type, data: { size: "md" } };
    default: {
      // Exhaustiveness sentinel — compile-time guard for new BlockTypes.
      const _exhaustive: never = type;
      void _exhaustive;
      return { id: genId("blk"), type: type as BlockType, data: {} };
    }
  }
}

/**
 * Coerce the raw JSONB into a v2 envelope and pull out Agent B's theme/brand
 * keys if present. Falls back to safe defaults for any missing piece.
 */
function normaliseInitial(raw: Record<string, unknown>): {
  v2: LandingContentV2;
  theme: ThemeConfig;
  brand: BrandConfig;
  migrated: boolean;
} {
  const wasV2 =
    raw &&
    typeof raw === "object" &&
    (raw as { version?: unknown }).version === 2;

  const v2 = migrateLegacyContent(raw);

  const themeRaw = (raw as { theme?: unknown }).theme;
  const brandRaw = (raw as { brand?: unknown }).brand;

  const theme: ThemeConfig =
    themeRaw && typeof themeRaw === "object" && "colors" in (themeRaw as object)
      ? (themeRaw as ThemeConfig)
      : { ...DEFAULT_THEME };
  const brand: BrandConfig =
    brandRaw && typeof brandRaw === "object"
      ? (brandRaw as BrandConfig)
      : { ...DEFAULT_BRAND };

  return { v2, theme, brand, migrated: !wasV2 };
}

export interface UseLpEditorState {
  // ── Identity ─────────────────────────────────────────────────────────
  templateId: string;
  // ── Name ─────────────────────────────────────────────────────────────
  name: string;
  setName: (v: string) => void;
  saveName: () => Promise<void>;
  // ── Theme / Brand ────────────────────────────────────────────────────
  theme: ThemeConfig;
  brand: BrandConfig;
  setTheme: (next: ThemeConfig) => void;
  setBrand: (next: BrandConfig) => void;
  // ── Blocks ───────────────────────────────────────────────────────────
  blocks: Block[];
  activeBlockId: string | null;
  setActiveBlockId: (id: string | null) => void;
  /** Replace one block's data/style/whatever, identified by id. */
  updateBlock: (id: string, patch: Partial<Block>) => void;
  /** Replace just `data` (deep, by key). Shortcut for inspector fields. */
  updateBlockData: (id: string, dataPatch: Record<string, unknown>) => void;
  /** Replace just `style` (by key). Shortcut for the Style-Tab. */
  updateBlockStyle: (
    id: string,
    stylePatch: Partial<NonNullable<Block["style"]>>,
  ) => void;
  resetBlockStyle: (id: string) => void;
  addBlock: (type: BlockType, atIndex?: number) => void;
  removeBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
  moveBlock: (id: string, direction: -1 | 1) => void;
  /** Drag-drop reorder: move `fromIndex` to `toIndex`. */
  reorderBlocks: (fromIndex: number, toIndex: number) => void;
  // ── Migration ────────────────────────────────────────────────────────
  /** True when the initial content was migrated from a v1 document. */
  showMigrationBanner: boolean;
  dismissMigrationBanner: () => void;
  // ── Save state ───────────────────────────────────────────────────────
  saveState: SaveState;
  lastSavedAt: number | null;
  /** Synchronous flush — call from the "Speichern" button. */
  saveNow: () => Promise<boolean>;
  // ── Undo ─────────────────────────────────────────────────────────────
  canUndo: boolean;
  undo: () => void;
}

export function useLpEditorState(
  initial: LpEditorInitialTemplate,
): UseLpEditorState {
  const initialNormalised = React.useMemo(
    () => normaliseInitial(initial.content),
    [initial.content],
  );

  const [name, setNameState] = React.useState(initial.name);
  const [theme, setThemeState] = React.useState<ThemeConfig>(
    initialNormalised.theme,
  );
  const [brand, setBrandState] = React.useState<BrandConfig>(
    initialNormalised.brand,
  );
  const [blocks, setBlocksState] = React.useState<Block[]>(
    initialNormalised.v2.blocks,
  );
  const [activeBlockId, setActiveBlockId] = React.useState<string | null>(
    null,
  );
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [showMigrationBanner, setShowMigrationBanner] = React.useState(
    initialNormalised.migrated,
  );

  // Undo stack stores prior snapshots. We snapshot blocks + theme + brand
  // together so an undo can revert any kind of edit.
  const undoStack = React.useRef<LpEditorSnapshot[]>([]);
  const [undoVersion, setUndoVersion] = React.useState(0);

  const pushUndo = React.useCallback(() => {
    undoStack.current.push({
      blocks: structuredCloneSafe(blocks),
      theme: structuredCloneSafe(theme),
      brand: structuredCloneSafe(brand),
    });
    if (undoStack.current.length > MAX_UNDO) {
      undoStack.current.splice(0, undoStack.current.length - MAX_UNDO);
    }
    setUndoVersion((v) => v + 1);
  }, [blocks, theme, brand]);

  const undo = React.useCallback(() => {
    const snap = undoStack.current.pop();
    if (!snap) return;
    setBlocksState(snap.blocks);
    setThemeState(snap.theme);
    setBrandState(snap.brand);
    setUndoVersion((v) => v + 1);
  }, []);

  // ── Mutators with undo bookkeeping ───────────────────────────────────
  const setTheme = React.useCallback(
    (next: ThemeConfig) => {
      pushUndo();
      setThemeState(next);
    },
    [pushUndo],
  );
  const setBrand = React.useCallback(
    (next: BrandConfig) => {
      pushUndo();
      setBrandState(next);
    },
    [pushUndo],
  );

  const updateBlock = React.useCallback(
    (id: string, patch: Partial<Block>) => {
      pushUndo();
      setBlocksState((prev) =>
        prev.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      );
    },
    [pushUndo],
  );

  const updateBlockData = React.useCallback(
    (id: string, dataPatch: Record<string, unknown>) => {
      pushUndo();
      setBlocksState((prev) =>
        prev.map((b) =>
          b.id === id ? { ...b, data: { ...b.data, ...dataPatch } } : b,
        ),
      );
    },
    [pushUndo],
  );

  const updateBlockStyle = React.useCallback(
    (id: string, stylePatch: Partial<NonNullable<Block["style"]>>) => {
      pushUndo();
      setBlocksState((prev) =>
        prev.map((b) =>
          b.id === id ? { ...b, style: { ...(b.style ?? {}), ...stylePatch } } : b,
        ),
      );
    },
    [pushUndo],
  );

  const resetBlockStyle = React.useCallback(
    (id: string) => {
      pushUndo();
      setBlocksState((prev) =>
        prev.map((b) => (b.id === id ? { ...b, style: undefined } : b)),
      );
    },
    [pushUndo],
  );

  const addBlock = React.useCallback(
    (type: BlockType, atIndex?: number) => {
      pushUndo();
      const fresh = makeDefaultBlock(type);
      setBlocksState((prev) => {
        const insertAt = atIndex ?? prev.length;
        const next = [...prev];
        next.splice(insertAt, 0, fresh);
        return next;
      });
      setActiveBlockId(fresh.id);
    },
    [pushUndo],
  );

  const removeBlock = React.useCallback(
    (id: string) => {
      pushUndo();
      setBlocksState((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        if (idx === -1) return prev;
        const next = prev.filter((b) => b.id !== id);
        // Promote a neighbouring block as the new active block so the
        // inspector never lands on an empty state by surprise.
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        setActiveBlockId(fallback?.id ?? null);
        return next;
      });
    },
    [pushUndo],
  );

  const duplicateBlock = React.useCallback(
    (id: string) => {
      pushUndo();
      setBlocksState((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        if (idx === -1) return prev;
        const src = prev[idx]!;
        const copy: Block = {
          ...src,
          id: genId(src.type),
          data: structuredCloneSafe(src.data),
          style: src.style ? structuredCloneSafe(src.style) : undefined,
        };
        const next = [...prev];
        next.splice(idx + 1, 0, copy);
        setActiveBlockId(copy.id);
        return next;
      });
    },
    [pushUndo],
  );

  const moveBlock = React.useCallback(
    (id: string, direction: -1 | 1) => {
      pushUndo();
      setBlocksState((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        const target = idx + direction;
        if (idx === -1 || target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        const [taken] = next.splice(idx, 1);
        if (!taken) return prev;
        next.splice(target, 0, taken);
        return next;
      });
    },
    [pushUndo],
  );

  const reorderBlocks = React.useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      pushUndo();
      setBlocksState((prev) => {
        if (
          fromIndex < 0 ||
          fromIndex >= prev.length ||
          toIndex < 0 ||
          toIndex >= prev.length
        )
          return prev;
        const next = [...prev];
        const [taken] = next.splice(fromIndex, 1);
        if (!taken) return prev;
        next.splice(toIndex, 0, taken);
        return next;
      });
    },
    [pushUndo],
  );

  // ── Auto-save ────────────────────────────────────────────────────────
  const lastSavedSnapshotRef = React.useRef<string>(
    serialiseSnapshot({
      blocks: initialNormalised.v2.blocks,
      theme: initialNormalised.theme,
      brand: initialNormalised.brand,
    }),
  );
  const savePromiseRef = React.useRef<Promise<boolean> | null>(null);

  const persist = React.useCallback(
    async (opts?: { includeName?: boolean }) => {
      const includeName = opts?.includeName === true;
      // Build the v2 envelope. We keep `legacy` if it was present so the
      // editor can keep showing the migration banner across reloads.
      const content: PersistedContent = {
        version: 2,
        theme: theme as ThemeConfig & Record<string, unknown>,
        brand,
        blocks,
      };
      setSaveState("saving");
      try {
        const body: Record<string, unknown> = { content };
        if (includeName) body.name = name.trim() || "Neue Vorlage";
        // Keep the legacy column in sync when we know the preset id.
        if (theme.preset && theme.preset !== "custom") {
          body.themeId = theme.preset;
        }
        const res = await fetch(`/api/landing-page-templates/${initial.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          setSaveState("error");
          return false;
        }
        setSaveState("saved");
        setLastSavedAt(Date.now());
        lastSavedSnapshotRef.current = serialiseSnapshot({
          blocks,
          theme,
          brand,
        });
        return true;
      } catch {
        setSaveState("error");
        return false;
      }
    },
    [initial.id, blocks, theme, brand, name],
  );

  // Debounced auto-save on blocks/theme/brand change. Name has its own
  // explicit blur-driven save (see `saveName` below).
  const isFirstAutoSave = React.useRef(true);
  React.useEffect(() => {
    if (isFirstAutoSave.current) {
      isFirstAutoSave.current = false;
      return;
    }
    const snapshot = serialiseSnapshot({ blocks, theme, brand });
    if (snapshot === lastSavedSnapshotRef.current) return;
    const handle = setTimeout(() => {
      savePromiseRef.current = persist();
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [blocks, theme, brand, persist]);

  // ── Public API: name ─────────────────────────────────────────────────
  const setName = React.useCallback((v: string) => {
    setNameState(v);
  }, []);

  const saveName = React.useCallback(async () => {
    if (!name.trim()) return;
    await persist({ includeName: true });
  }, [name, persist]);

  // ── Public API: explicit save ────────────────────────────────────────
  const saveNow = React.useCallback(async () => {
    return persist({ includeName: true });
  }, [persist]);

  // ── Cmd/Ctrl + Z global handler ─────────────────────────────────────
  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key !== "z" && e.key !== "Z") return;
      // Skip when focus is inside a form element — let the browser
      // handle native undo in inputs/textareas. We only intercept
      // when the user is clearly outside an editable field.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      undo();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo]);

  // Beforeunload guard while a save is in flight.
  React.useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (saveState === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  return {
    templateId: initial.id,
    name,
    setName,
    saveName,
    theme,
    brand,
    setTheme,
    setBrand,
    blocks,
    activeBlockId,
    setActiveBlockId,
    updateBlock,
    updateBlockData,
    updateBlockStyle,
    resetBlockStyle,
    addBlock,
    removeBlock,
    duplicateBlock,
    moveBlock,
    reorderBlocks,
    showMigrationBanner,
    dismissMigrationBanner: React.useCallback(
      () => setShowMigrationBanner(false),
      [],
    ),
    saveState,
    lastSavedAt,
    saveNow,
    canUndo: undoStack.current.length > 0 || undoVersion > 0,
    undo,
  };
}

/**
 * Deterministic serialisation used by the auto-save change detector.
 * We sort theme/brand keys so object-spread order changes don't trip a
 * spurious "dirty" reading.
 */
function serialiseSnapshot(snap: LpEditorSnapshot): string {
  return JSON.stringify({
    blocks: snap.blocks,
    theme: sortedJson(snap.theme as unknown as Record<string, unknown>),
    brand: sortedJson(snap.brand as unknown as Record<string, unknown>),
  });
}

function sortedJson(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    out[key] =
      v && typeof v === "object" && !Array.isArray(v)
        ? sortedJson(v as Record<string, unknown>)
        : v;
  }
  return out;
}

/**
 * `structuredClone` polyfill via JSON round-trip. Acceptable for our
 * editor state, which is pure JSON anyway.
 */
function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // fall through to JSON
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
