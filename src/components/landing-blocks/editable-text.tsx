"use client";

/**
 * Inline-Editing-Bruecke fuer den Canvas-Builder (Konzept Abschnitt 6.1/6.2).
 *
 * Vertrag:
 *   - Block-Komponenten wrappen ihre Textfelder in <EditableText path raw>
 *     {gerenderterText}</EditableText>.
 *   - Ausserhalb des Builders (oeffentliche Seite, Thumbnails) gibt es keinen
 *     Provider → EditableText rendert exakt {children}, ohne Wrapper-DOM.
 *     Das Server-HTML der Public-Seite bleibt dadurch unveraendert.
 *   - Im Builder stellt der Canvas pro Block einen EditableBlockProvider
 *     bereit. update(path, value) schreibt den Rohtext (mit {{platzhaltern}})
 *     zurueck in block.data — Commit erst on-blur (bzw. Enter bei
 *     einzeiligen Feldern), damit der Undo-Stack nicht pro Tastendruck
 *     waechst.
 *
 * Implementierung:
 *   - Der Rohtext wird als Segmentliste gerendert (editable-text-model.ts):
 *     Text bleibt Text, {{key}} / {{key|fallback}} werden zu farbigen,
 *     nicht editierbaren Chips (contentEditable={false}).
 *   - Waehrend des Tippens mutiert der Browser das DOM direkt; React fasst
 *     die Kinder nicht an, solange `segments` unveraendert bleibt. Nach
 *     jedem Commit (und bei programmatischen Aenderungen wie Chip-Einfuegen
 *     via Menue) wird ueber einen `version`-Key neu gemountet, damit
 *     React-Baum und DOM wieder kanonisch uebereinstimmen.
 *   - Chips werden per Event-Delegation angeklickt (data-ph-key), damit
 *     auch programmatisch (document.createElement) eingefuegte Chips ohne
 *     React-Handler funktionieren.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  parseRawToSegments,
  placeholderLabel,
  serializeSegments,
  type Segment,
} from "./editable-text-model";

export interface PlaceholderOption {
  /** Datenschluessel, z. B. "firstName". */
  key: string;
  /** Klartext-Label, z. B. "Vorname des Leads". */
  label: string;
}

export interface EditableBlockContextValue {
  /** Schreibt einen Rohtext-Wert an `path` (Punkt-Notation, Indizes erlaubt,
   *  z. B. "items.0.q") in die data des umgebenden Blocks. */
  update: (path: string, value: string) => void;
  /** Verfuegbare Platzhalter fuer das {{-Menue. */
  placeholders: PlaceholderOption[];
  /** true = "Mit Beispiel-Lead ansehen": Chips werden durch Beispieldaten
   *  ersetzt, Inline-Editing ist deaktiviert. */
  sampleMode: boolean;
}

const EditableBlockContext =
  React.createContext<EditableBlockContextValue | null>(null);

export function EditableBlockProvider({
  value,
  children,
}: {
  value: EditableBlockContextValue;
  children: React.ReactNode;
}) {
  return (
    <EditableBlockContext.Provider value={value}>
      {children}
    </EditableBlockContext.Provider>
  );
}

export function useEditableBlock(): EditableBlockContextValue | null {
  return React.useContext(EditableBlockContext);
}

export interface EditableTextProps {
  /** Punkt-Pfad innerhalb von block.data, z. B. "headline" oder "items.0.q". */
  path: string;
  /** Rohtext inkl. {{platzhalter|fallback}}. */
  raw: string;
  /** Mehrzeilig (Enter erlaubt, Absaetze via \n). */
  multiline?: boolean;
  /** Zeigt Fett/Aufzaehlungs-Knoepfe in der Mini-Leiste (MiniMarkdown-Felder). */
  markdown?: boolean;
  /** Platzhalter-Text wenn raw leer ist (nur im Editor sichtbar). */
  emptyHint?: string;
  className?: string;
  /** Gerendertes Ergebnis (Platzhalter aufgeloest) fuer die Public-Seite. */
  children: React.ReactNode;
}

/**
 * Ohne Provider (Public-Seite) oder im Beispiel-Lead-Modus: reiner
 * Pass-Through — das Server-HTML bleibt byte-identisch. Im Builder
 * uebernimmt die Impl-Komponente das contentEditable-Rendering.
 */
export function EditableText(props: EditableTextProps): React.ReactNode {
  const ctx = useEditableBlock();
  if (!ctx || ctx.sampleMode) return <>{props.children}</>;
  return <EditableTextImpl {...props} ctx={ctx} />;
}

/**
 * Client-Helfer fuer Felder, die auf der Public-Seite bei leerem Inhalt
 * gar nicht gerendert werden (z. B. `headline && <h2>…`):
 *
 *   <MaybeEmptyField present={!!headline}>
 *     <h2><EditableText … emptyHint="Überschrift eingeben">{headline}</EditableText></h2>
 *   </MaybeEmptyField>
 *
 * present=true  → immer rendern (Public unveraendert).
 * present=false → nur im Edit-Modus rendern (Provider da, kein sampleMode),
 *                 damit leere Felder anklickbar bleiben. Auf dem Server /
 *                 der Public-Seite ergibt das null, exakt wie bisher.
 */
export function MaybeEmptyField({
  present,
  children,
}: {
  present: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  const ctx = useEditableBlock();
  if (present) return <>{children}</>;
  if (!ctx || ctx.sampleMode) return null;
  return <>{children}</>;
}

/* ------------------------------------------------------------------ */
/* Chip-DOM                                                            */
/* ------------------------------------------------------------------ */

const CHIP_CLASS =
  "inline-flex items-center rounded-full bg-brand-soft px-1.5 text-[0.82em] " +
  "font-medium text-brand-deep align-baseline cursor-pointer select-none " +
  "whitespace-nowrap";

/** Erzeugt das Chip-Markup — identisch zum React-Rendering in <ChipSpan>. */
function buildChipElement(
  key: string,
  fallback: string | undefined,
  placeholders: PlaceholderOption[],
): HTMLSpanElement {
  const el = document.createElement("span");
  el.setAttribute("contenteditable", "false");
  el.dataset.phKey = key;
  if (fallback) el.dataset.phFallback = fallback;
  el.className = CHIP_CLASS;
  el.textContent = placeholderLabel(key, placeholders);
  return el;
}

function ChipSpan({
  segment,
  placeholders,
}: {
  segment: Extract<Segment, { type: "placeholder" }>;
  placeholders: PlaceholderOption[];
}) {
  return (
    <span
      contentEditable={false}
      data-ph-key={segment.key}
      data-ph-fallback={segment.fallback}
      title={
        segment.fallback
          ? `Falls leer: "${segment.fallback}"`
          : "Platzhalter, Klick für Optionen"
      }
      className={CHIP_CLASS}
    >
      {placeholderLabel(segment.key, placeholders)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* DOM → Segmente                                                      */
/* ------------------------------------------------------------------ */

/**
 * Traversiert das contentEditable-DOM zurueck in Segmente: Chips werden
 * zu Platzhaltern, <br> und Block-Elemente (falls ein Browser doch welche
 * einfuegt) zu Zeilenumbruechen, alles andere zu Text. nbsp und
 * Zero-Width-Spaces (Caret-Anker) werden normalisiert.
 */
export function domToSegments(root: HTMLElement): Segment[] {
  const out: Segment[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === "text") last.text += text;
    else out.push({ type: "text", text });
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.nodeValue ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/\u200b/g, "");
      pushText(value);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.dataset && el.dataset.phKey) {
      const fallback = el.dataset.phFallback;
      out.push(
        fallback
          ? { type: "placeholder", key: el.dataset.phKey, fallback }
          : { type: "placeholder", key: el.dataset.phKey },
      );
      return;
    }
    if (el.tagName === "BR") {
      pushText("\n");
      return;
    }
    const isBlock = /^(DIV|P|LI|UL|OL|H[1-6])$/.test(el.tagName);
    if (isBlock && out.length > 0) pushText("\n");
    el.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out;
}

/* ------------------------------------------------------------------ */
/* Editor-Implementierung                                              */
/* ------------------------------------------------------------------ */

const TOOLBAR_BTN =
  "flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs " +
  "font-medium text-neutral-700 hover:bg-brand-soft hover:text-brand-deep " +
  "transition-colors";

type MenuSource = "trigger" | "toolbar";

function EditableTextImpl({
  path,
  raw,
  multiline,
  markdown,
  emptyHint,
  className,
  ctx,
}: EditableTextProps & { ctx: EditableBlockContextValue }): React.ReactElement {
  const wrapperRef = React.useRef<HTMLSpanElement | null>(null);
  const rootRef = React.useRef<HTMLSpanElement | null>(null);
  /** Zuletzt committeter/übernommener Rohtext (Vergleichsbasis). */
  const localRawRef = React.useRef(raw);
  const focusedRef = React.useRef(false);

  const [segments, setSegments] = React.useState<Segment[]>(() =>
    parseRawToSegments(raw),
  );
  /** Key des contentEditable-Elements: Bump = Voll-Remount nach Commit. */
  const [version, setVersion] = React.useState(0);
  const [focused, setFocused] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState<MenuSource | null>(null);
  const [chipPopover, setChipPopover] = React.useState<{
    el: HTMLElement;
    key: string;
    fallback: string;
  } | null>(null);

  // Externe raw-Aenderungen (Undo/Redo im Canvas, Panel-Edits) uebernehmen,
  // solange das Feld nicht gerade editiert wird.
  React.useEffect(() => {
    if (focusedRef.current) return;
    if (raw === localRawRef.current) return;
    localRawRef.current = raw;
    setSegments(parseRawToSegments(raw));
    setVersion((v) => v + 1);
  }, [raw]);

  const commit = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const serialized = serializeSegments(domToSegments(root));
    if (serialized !== localRawRef.current) {
      localRawRef.current = serialized;
      ctx.update(path, serialized);
    }
    setSegments(parseRawToSegments(serialized));
    setVersion((v) => v + 1);
  }, [ctx, path]);

  /* -------------------- Fokus / Blur ------------------------------- */

  const onWrapperFocus = () => {
    focusedRef.current = true;
    setFocused(true);
  };

  const onWrapperBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    // Fokuswechsel innerhalb des Wrappers (Toolbar, Menue, Popover-Input)
    // ist kein "Verlassen" — nichts schliessen, nichts committen.
    if (next && wrapperRef.current && wrapperRef.current.contains(next)) return;
    focusedRef.current = false;
    setFocused(false);
    setMenuOpen(null);
    setChipPopover(null);
    commit();
  };

  /* -------------------- Text-Einfuegen ------------------------------ */

  const insertPlainText = React.useCallback((text: string) => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    try {
      if (document.execCommand("insertText", false, text)) return;
    } catch {
      // execCommand nicht verfuegbar (z. B. jsdom) → manueller Fallback.
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }, []);

  /* -------------------- {{-Trigger ---------------------------------- */

  /** true wenn direkt vor dem (kollabierten) Cursor "{{" steht. */
  const caretHasTrigger = React.useCallback((): boolean => {
    const root = rootRef.current;
    if (!root) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) {
      return false;
    }
    const offset = sel.anchorOffset;
    const data = (node as Text).data;
    return offset >= 2 && data.slice(offset - 2, offset) === "{{";
  }, []);

  const onInput = () => {
    if (caretHasTrigger()) {
      setMenuOpen("trigger");
    } else if (menuOpen === "trigger") {
      setMenuOpen(null);
    }
  };

  /* -------------------- Platzhalter einfuegen ----------------------- */

  const insertPlaceholder = (key: string) => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    let range: Range;
    if (
      sel &&
      sel.rangeCount > 0 &&
      root.contains(sel.getRangeAt(0).startContainer)
    ) {
      range = sel.getRangeAt(0);
      range.deleteContents();
    } else {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
    }
    // Wurde das Menue durch Tippen von "{{" geoeffnet: die beiden
    // getippten Zeichen vor dem Cursor entfernen.
    const start = range.startContainer;
    if (start.nodeType === Node.TEXT_NODE) {
      const textNode = start as Text;
      const off = range.startOffset;
      if (off >= 2 && textNode.data.slice(off - 2, off) === "{{") {
        textNode.deleteData(off - 2, 2);
        range.setStart(textNode, off - 2);
        range.collapse(true);
      }
    }
    const chip = buildChipElement(key, undefined, ctx.placeholders);
    range.insertNode(chip);
    // Caret hinter den Chip setzen (leerer Textknoten als Anker).
    const anchor = document.createTextNode("");
    chip.after(anchor);
    const caret = document.createRange();
    caret.setStart(anchor, 0);
    caret.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(caret);
    setMenuOpen(null);
  };

  /* -------------------- Mini-Leiste: Fett / Aufzaehlung ------------- */

  const applyBold = () => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    const selected = sel && !sel.isCollapsed ? sel.toString() : "";
    insertPlainText("**" + (selected || "Text") + "**");
  };

  const applyBullet = () => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    // Steht der Cursor am Zeilenanfang? (Text davor endet mit \n oder leer)
    const probe = sel.getRangeAt(0).cloneRange();
    probe.collapse(true);
    const before = document.createRange();
    before.selectNodeContents(root);
    before.setEnd(probe.startContainer, probe.startOffset);
    const textBefore = before.toString();
    const atLineStart = textBefore === "" || textBefore.endsWith("\n");
    insertPlainText(atLineStart ? "- " : "\n- ");
  };

  /* -------------------- Tastatur ------------------------------------ */

  const onKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (menuOpen || chipPopover) {
        setMenuOpen(null);
        setChipPopover(null);
      } else {
        rootRef.current?.blur();
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (menuOpen) {
        setMenuOpen(null);
        return;
      }
      if (multiline) {
        insertPlainText("\n");
      } else {
        // Einzeilig: Enter = uebernehmen. Der Blur loest den Commit aus.
        rootRef.current?.blur();
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLSpanElement>) => {
    e.preventDefault();
    let text = e.clipboardData.getData("text/plain");
    if (!multiline) text = text.replace(/\s*\n+\s*/g, " ");
    if (text) insertPlainText(text);
  };

  /* -------------------- Klicks (Chips + Navigation abfangen) -------- */

  const onEditableClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    // Im Edit-Modus keine Link-Navigation / <summary>-Toggles ausloesen.
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const chip = target.closest
      ? (target.closest("[data-ph-key]") as HTMLElement | null)
      : null;
    if (chip && rootRef.current && rootRef.current.contains(chip)) {
      setChipPopover({
        el: chip,
        key: chip.dataset.phKey ?? "",
        fallback: chip.dataset.phFallback ?? "",
      });
    }
  };

  /* -------------------- Chip-Popover Aktionen ----------------------- */

  const saveChipFallback = (value: string) => {
    const popover = chipPopover;
    if (!popover) return;
    const trimmed = value.trim();
    if (trimmed) popover.el.dataset.phFallback = trimmed;
    else delete popover.el.dataset.phFallback;
    setChipPopover(null);
    commit();
  };

  const removeChip = () => {
    const popover = chipPopover;
    if (!popover) return;
    popover.el.remove();
    setChipPopover(null);
    commit();
  };

  /* -------------------- Rendering ----------------------------------- */

  const showToolbar = focused || menuOpen !== null || chipPopover !== null;

  return (
    <span
      ref={wrapperRef}
      className="relative inline-block max-w-full align-top"
      onFocus={onWrapperFocus}
      onBlur={onWrapperBlur}
    >
      {showToolbar && (
        <span
          className={cn(
            "absolute bottom-full left-0 z-40 mb-1.5 flex items-center gap-0.5",
            "whitespace-nowrap rounded-lg border border-line bg-white p-0.5",
            "font-sans text-neutral-700 shadow-card",
          )}
          // Fokus im Textfeld behalten: mousedown auf der Leiste darf
          // das contentEditable nicht blurren.
          onMouseDown={(e) => e.preventDefault()}
        >
          {markdown && (
            <button
              type="button"
              title="Fett"
              aria-label="Fett"
              className={TOOLBAR_BTN}
              onClick={applyBold}
            >
              <span className="font-bold">F</span>
            </button>
          )}
          {markdown && (
            <button
              type="button"
              title="Aufzählung"
              aria-label="Aufzählung"
              className={TOOLBAR_BTN}
              onClick={applyBullet}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                className="size-3.5"
              >
                <circle cx="2.5" cy="3.5" r="1.4" fill="currentColor" />
                <circle cx="2.5" cy="8" r="1.4" fill="currentColor" />
                <circle cx="2.5" cy="12.5" r="1.4" fill="currentColor" />
                <path
                  d="M6 3.5h8M6 8h8M6 12.5h8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          <button
            type="button"
            title="Platzhalter einfügen"
            aria-label="Platzhalter einfügen"
            className={TOOLBAR_BTN}
            onClick={() =>
              setMenuOpen((open) => (open === "toolbar" ? null : "toolbar"))
            }
          >
            {"{{ }}"}
          </button>
        </span>
      )}

      <span
        key={version}
        ref={rootRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline={multiline ? true : undefined}
        data-empty-hint={emptyHint ?? ""}
        className={cn(
          "inline-block max-w-full min-w-6 cursor-text whitespace-pre-wrap",
          "rounded-sm outline-none",
          "focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-brand-300",
          emptyHint &&
            "empty:before:content-[attr(data-empty-hint)] empty:before:opacity-50 empty:before:pointer-events-none",
          className,
        )}
        onKeyDown={onKeyDown}
        onInput={onInput}
        onPaste={onPaste}
        onClick={onEditableClick}
      >
        {segments.map((seg, idx) =>
          seg.type === "text" ? (
            <React.Fragment key={idx}>{seg.text}</React.Fragment>
          ) : (
            <ChipSpan key={idx} segment={seg} placeholders={ctx.placeholders} />
          ),
        )}
      </span>

      {menuOpen !== null && (
        <span
          className={cn(
            "absolute top-full left-0 z-50 mt-1.5 flex max-h-64 min-w-60 flex-col",
            "overflow-auto rounded-xl border border-line bg-white p-1",
            "font-sans text-sm font-normal normal-case tracking-normal text-neutral-800 shadow-lift",
          )}
          onMouseDown={(e) => e.preventDefault()}
        >
          {ctx.placeholders.length === 0 && (
            <span className="px-2.5 py-2 text-xs text-neutral-500">
              Keine Platzhalter verfügbar
            </span>
          )}
          {ctx.placeholders.map((p) => (
            <button
              key={p.key}
              type="button"
              className="flex items-baseline justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left hover:bg-brand-soft"
              onClick={() => insertPlaceholder(p.key)}
            >
              <span>{p.label}</span>
              <span className="text-[11px] text-neutral-400">
                {"{{" + p.key + "}}"}
              </span>
            </button>
          ))}
        </span>
      )}

      {chipPopover && (
        <ChipPopover
          key={chipPopover.key + ":" + chipPopover.fallback}
          fallback={chipPopover.fallback}
          onSave={saveChipFallback}
          onRemove={removeChip}
          onClose={() => setChipPopover(null)}
        />
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Chip-Popover ("Falls leer: …")                                      */
/* ------------------------------------------------------------------ */

function ChipPopover({
  fallback,
  onSave,
  onRemove,
  onClose,
}: {
  fallback: string;
  onSave: (value: string) => void;
  onRemove: () => void;
  onClose: () => void;
}): React.ReactElement {
  const [value, setValue] = React.useState(fallback);
  return (
    <span
      className={cn(
        "absolute top-full left-0 z-50 mt-1.5 flex w-64 flex-col gap-2",
        "rounded-xl border border-line bg-white p-3",
        "font-sans text-sm font-normal normal-case tracking-normal text-neutral-800 shadow-lift",
      )}
      // Fokus nicht klauen — ausser der Klick zielt auf den Input selbst.
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault();
      }}
    >
      <span className="text-xs font-medium text-neutral-600">Falls leer:</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="z. B. Hallo"
        className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand-300"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="text-[11px] leading-snug text-neutral-400">
        Leer speichern entfernt den Fallback-Text.
      </span>
      <span className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded-lg bg-brand-deep px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
          onClick={() => onSave(value)}
        >
          Speichern
        </button>
        <button
          type="button"
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft"
          onClick={onRemove}
        >
          Entfernen
        </button>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* deepSet                                                             */
/* ------------------------------------------------------------------ */

/**
 * Immutable deep-set fuer Punkt-Pfade mit numerischen Array-Indizes.
 * deepSet({items:[{q:"a"}]}, "items.0.q", "b") → neues Objekt, Original
 * unangetastet. Fehlende Zwischenknoten werden als Objekt angelegt.
 */
export function deepSet(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split(".");
  function setAt(node: unknown, idx: number): unknown {
    const key = keys[idx]!;
    const isLast = idx === keys.length - 1;
    const numeric = /^\d+$/.test(key);
    if (numeric) {
      const arr = Array.isArray(node) ? [...node] : [];
      const i = Number(key);
      arr[i] = isLast ? value : setAt(arr[i], idx + 1);
      return arr;
    }
    const rec =
      node && typeof node === "object" && !Array.isArray(node)
        ? { ...(node as Record<string, unknown>) }
        : {};
    rec[key] = isLast ? value : setAt(rec[key], idx + 1);
    return rec;
  }
  return setAt(obj, 0) as Record<string, unknown>;
}
