"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Loader2,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { LpPreview } from "./lp-preview";

/**
 * The four built-in themes. Mini-preview tokens are kept here so the
 * theme picker can render swatch cards without pulling them in from the
 * preview component. The order matters: it is rendered as a 2x2 grid.
 */
const THEME_CARDS: ReadonlyArray<{
  id: "noir" | "clean" | "gradient" | "warm";
  label: string;
  tagline: string;
  bg: string;
  accent: string;
  text: string;
}> = [
  {
    id: "noir",
    label: "Noir",
    tagline: "Dunkel, edel.",
    bg: "#07070f",
    accent: "#818cf8",
    text: "#ffffff",
  },
  {
    id: "clean",
    label: "Clean",
    tagline: "Hell, sachlich.",
    bg: "#ffffff",
    accent: "#2563eb",
    text: "#0f172a",
  },
  {
    id: "gradient",
    label: "Gradient",
    tagline: "Lebendig, frech.",
    bg: "linear-gradient(135deg, #a855f7, #6366f1 55%, #2563eb)",
    accent: "#f59e0b",
    text: "#ffffff",
  },
  {
    id: "warm",
    label: "Warm",
    tagline: "Erdig, einladend.",
    bg: "#fdf8f3",
    accent: "#c2622c",
    text: "#1c1207",
  },
];

const PLACEHOLDERS = [
  { token: "{{firstName}}", label: "Vorname" },
  { token: "{{lastName}}", label: "Nachname" },
  { token: "{{company}}", label: "Firma" },
];

type ThemeId = (typeof THEME_CARDS)[number]["id"];

interface TemplateContent {
  headline?: string;
  bodyText?: string;
  primaryButtonText?: string;
  primaryButtonUrl?: string;
  secondaryButtonText?: string;
  secondaryButtonUrl?: string;
  footnote?: string;
  bgColor?: string;
  textColor?: string;
  accentColor?: string;
}

export interface LpEditorTemplate {
  id: string;
  name: string;
  themeId: string;
  content: Record<string, unknown>;
}

type SaveState = "idle" | "saving" | "saved" | "error";

function readContent(content: Record<string, unknown>): TemplateContent {
  const keys: Array<keyof TemplateContent> = [
    "headline",
    "bodyText",
    "primaryButtonText",
    "primaryButtonUrl",
    "secondaryButtonText",
    "secondaryButtonUrl",
    "footnote",
    "bgColor",
    "textColor",
    "accentColor",
  ];
  const out: TemplateContent = {};
  for (const key of keys) {
    const v = content[key];
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

export function LpEditor({ template }: { template: LpEditorTemplate }) {
  const router = useRouter();
  const { toast } = useToast();

  const initialContent = React.useMemo(
    () => readContent(template.content),
    [template.content],
  );

  const [name, setName] = React.useState(template.name);
  const [themeId, setThemeId] = React.useState<ThemeId>(
    (template.themeId as ThemeId) || "clean",
  );
  const [content, setContent] = React.useState<TemplateContent>(initialContent);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [overridesOpen, setOverridesOpen] = React.useState(false);

  // Track the last-persisted snapshot so we can compute "dirty" state for
  // the unsaved-changes warning and so debounced saves only fire on
  // actual diff (not initial mount).
  const lastSavedRef = React.useRef<{
    name: string;
    themeId: ThemeId;
    content: TemplateContent;
  }>({
    name: template.name,
    themeId: (template.themeId as ThemeId) || "clean",
    content: initialContent,
  });

  const headlineRef = React.useRef<HTMLInputElement | null>(null);

  // ── Save ──────────────────────────────────────────────────────────────
  const persist = React.useCallback(
    async (payload: {
      name?: string;
      themeId?: ThemeId;
      content?: TemplateContent;
    }) => {
      setSaveState("saving");
      try {
        const body: Record<string, unknown> = {};
        if (payload.name !== undefined) body.name = payload.name;
        if (payload.themeId !== undefined) body.themeId = payload.themeId;
        if (payload.content !== undefined) body.content = payload.content;
        const res = await fetch(
          `/api/landing-page-templates/${template.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          setSaveState("error");
          return false;
        }
        setSaveState("saved");
        // After a successful save, update our snapshot so the dirty
        // detector compares against the new ground truth.
        lastSavedRef.current = {
          name: payload.name ?? lastSavedRef.current.name,
          themeId: payload.themeId ?? lastSavedRef.current.themeId,
          content: payload.content ?? lastSavedRef.current.content,
        };
        return true;
      } catch {
        setSaveState("error");
        return false;
      }
    },
    [template.id],
  );

  // Debounced auto-save. The timer is rescheduled on every state change
  // and only fires after 800ms of quiet. We intentionally avoid sending
  // the `name` field in auto-saves (name has its own save-on-blur path
  // in the page header) so quick typing in the title doesn't spam PATCH.
  const isFirstRun = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const last = lastSavedRef.current;
    const changed =
      themeId !== last.themeId ||
      JSON.stringify(content) !== JSON.stringify(last.content);
    if (!changed) return;

    const handle = setTimeout(() => {
      void persist({ themeId, content });
    }, 800);
    return () => clearTimeout(handle);
  }, [themeId, content, persist]);

  // Unsaved-changes warning on browser navigation away.
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

  // ── Handlers ──────────────────────────────────────────────────────────
  function setContentField<K extends keyof TemplateContent>(
    key: K,
    value: TemplateContent[K],
  ) {
    setContent((prev) => ({ ...prev, [key]: value }));
  }

  async function onNameBlur() {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(lastSavedRef.current.name);
      return;
    }
    if (trimmed === lastSavedRef.current.name) return;
    await persist({ name: trimmed });
  }

  function insertPlaceholder(token: string) {
    const el = headlineRef.current;
    const current = content.headline ?? "";
    if (!el) {
      setContentField("headline", current + token);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setContentField("headline", next);
    // Restore caret position to right after the inserted token on the
    // next paint so the user can keep typing without losing context.
    requestAnimationFrame(() => {
      const pos = start + token.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function resetColorOverrides() {
    setContent((prev) => {
      const next = { ...prev };
      delete next.bgColor;
      delete next.textColor;
      delete next.accentColor;
      return next;
    });
  }

  async function onManualSave() {
    const ok = await persist({ name: name.trim() || "Neue Vorlage", themeId, content });
    if (ok) {
      toast({
        title: "Gespeichert",
        description: "Deine Aenderungen wurden gespeichert.",
        variant: "success",
      });
      router.refresh();
    } else {
      toast({
        title: "Speichern fehlgeschlagen",
        description: "Bitte erneut versuchen.",
        variant: "danger",
      });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <>
      {/* Custom page header so we can edit the title inline */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-6 mb-6 border-b border-line">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Link
            href="/landingpages"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Alle Vorlagen
          </Link>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={onNameBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            className="text-2xl sm:text-[28px] font-bold tracking-tight text-ink leading-tight bg-transparent border-0 outline-none w-full max-w-xl focus:bg-surface-soft focus:ring-2 focus:ring-brand/20 rounded-squircle-sm px-2 -mx-2 transition-colors"
            placeholder="Vorlagen-Name"
            aria-label="Vorlagen-Name"
          />
        </div>
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          <SaveStatusBadge state={saveState} />
          <Button onClick={onManualSave} loading={saveState === "saving"}>
            Speichern
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
        {/* Editor panel */}
        <aside className="space-y-5">
          {/* Theme picker */}
          <Card>
            <CardHeader>
              <CardTitle>Theme</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2.5">
                {THEME_CARDS.map((t) => {
                  const active = themeId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setThemeId(t.id)}
                      className={cn(
                        "flex flex-col text-left rounded-squircle-md border p-2 transition-all duration-200 ease-spring",
                        active
                          ? "border-brand ring-2 ring-brand/20"
                          : "border-line hover:border-brand/50",
                      )}
                    >
                      <span
                        className="aspect-[5/3] rounded-squircle-sm relative overflow-hidden flex items-end justify-start p-2"
                        style={{ background: t.bg }}
                      >
                        <span
                          className="size-4 rounded-full shadow-sm"
                          style={{ background: t.accent }}
                        />
                      </span>
                      <span
                        className="block text-xs font-semibold text-ink mt-2"
                      >
                        {t.label}
                      </span>
                      <span className="block text-[11px] text-ink-muted leading-tight">
                        {t.tagline}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Content */}
          <Card>
            <CardHeader>
              <CardTitle>Inhalt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="headline">Headline</Label>
                <Input
                  id="headline"
                  ref={headlineRef}
                  value={content.headline ?? ""}
                  onChange={(e) => setContentField("headline", e.target.value)}
                  placeholder="Hey {{firstName}}, das hier ist für dich!"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {PLACEHOLDERS.map((p) => (
                    <button
                      key={p.token}
                      type="button"
                      onClick={() => insertPlaceholder(p.token)}
                      className="inline-flex items-center gap-1 rounded-full bg-brand-soft text-brand-deep text-[11px] font-medium px-2.5 py-1 hover:bg-brand-100 transition-colors"
                      title={`${p.label} einfuegen`}
                    >
                      {p.token}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="bodyText">Body-Text</Label>
                <Textarea
                  id="bodyText"
                  value={content.bodyText ?? ""}
                  onChange={(e) => setContentField("bodyText", e.target.value)}
                  placeholder="Erklaere kurz, worum es geht."
                  rows={4}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="primaryButtonText">Primary-Button Text</Label>
                  <Input
                    id="primaryButtonText"
                    value={content.primaryButtonText ?? ""}
                    onChange={(e) =>
                      setContentField("primaryButtonText", e.target.value)
                    }
                    placeholder="Termin buchen"
                  />
                </div>
                <div>
                  <Label htmlFor="primaryButtonUrl">Primary-Button URL</Label>
                  <Input
                    id="primaryButtonUrl"
                    type="url"
                    value={content.primaryButtonUrl ?? ""}
                    onChange={(e) =>
                      setContentField("primaryButtonUrl", e.target.value)
                    }
                    placeholder="https://calendly.com"
                  />
                </div>
                <div>
                  <Label htmlFor="secondaryButtonText">
                    Secondary-Button Text
                  </Label>
                  <Input
                    id="secondaryButtonText"
                    value={content.secondaryButtonText ?? ""}
                    onChange={(e) =>
                      setContentField("secondaryButtonText", e.target.value)
                    }
                    placeholder="Mehr erfahren"
                  />
                </div>
                <div>
                  <Label htmlFor="secondaryButtonUrl">Secondary-Button URL</Label>
                  <Input
                    id="secondaryButtonUrl"
                    type="url"
                    value={content.secondaryButtonUrl ?? ""}
                    onChange={(e) =>
                      setContentField("secondaryButtonUrl", e.target.value)
                    }
                    placeholder="#"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="footnote">Footer-Text (optional)</Label>
                <Input
                  id="footnote"
                  value={content.footnote ?? ""}
                  onChange={(e) => setContentField("footnote", e.target.value)}
                  placeholder="Impressum &amp; Datenschutz"
                />
              </div>
            </CardContent>
          </Card>

          {/* Color overrides */}
          <Card>
            <button
              type="button"
              onClick={() => setOverridesOpen((v) => !v)}
              className="w-full flex items-center justify-between p-6 pb-3"
              aria-expanded={overridesOpen}
            >
              <CardTitle>Farb-Overrides</CardTitle>
              {overridesOpen ? (
                <ChevronUp className="size-4 text-ink-muted" />
              ) : (
                <ChevronDown className="size-4 text-ink-muted" />
              )}
            </button>
            {overridesOpen && (
              <CardContent className="space-y-4">
                <ColorRow
                  label="Hintergrund"
                  value={content.bgColor ?? ""}
                  onChange={(v) => setContentField("bgColor", v)}
                  fallback="#ffffff"
                />
                <ColorRow
                  label="Text"
                  value={content.textColor ?? ""}
                  onChange={(v) => setContentField("textColor", v)}
                  fallback="#0f172a"
                />
                <ColorRow
                  label="Akzent"
                  value={content.accentColor ?? ""}
                  onChange={(v) => setContentField("accentColor", v)}
                  fallback="#2563eb"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetColorOverrides}
                  iconLeft={<RotateCcw className="size-3.5" />}
                  className="w-full"
                >
                  Auf Theme-Default zurücksetzen
                </Button>
              </CardContent>
            )}
          </Card>
        </aside>

        {/* Live preview */}
        <section className="min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>Live-Vorschau</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Browser-frame chrome */}
              <div className="rounded-squircle-md border border-line overflow-hidden bg-surface-soft">
                <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-line bg-surface">
                  <span className="size-2.5 rounded-full bg-line" />
                  <span className="size-2.5 rounded-full bg-line" />
                  <span className="size-2.5 rounded-full bg-line" />
                  <span className="ml-3 text-[11px] text-ink-muted truncate">
                    app.videocomet.de/v/demo
                  </span>
                </div>
                <div className="p-3 sm:p-4">
                  <LpPreview
                    template={{
                      themeId,
                      content: content as Record<string, unknown>,
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}

function SaveStatusBadge({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        <Loader2 className="size-3.5 animate-spin" />
        Speichert...
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ok">
        <CircleCheck className="size-3.5" />
        Gespeichert
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-danger">
        <TriangleAlert className="size-3.5" />
        Fehler
      </span>
    );
  }
  return null;
}

function ColorRow({
  label,
  value,
  onChange,
  fallback,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fallback: string;
}) {
  const current = value || fallback;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <Label className="mb-1.5">{label}</Label>
        <div className="flex items-center gap-2">
          <label className="relative inline-flex shrink-0">
            <input
              type="color"
              value={current}
              onChange={(e) => onChange(e.target.value)}
              className="absolute inset-0 size-10 opacity-0 cursor-pointer"
              aria-label={`${label} Farbe wählen`}
            />
            <span
              className="size-10 rounded-squircle-sm border border-line shadow-card pointer-events-none"
              style={{ background: current }}
            />
          </label>
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={fallback}
            className="font-mono text-xs"
          />
        </div>
      </div>
    </div>
  );
}
