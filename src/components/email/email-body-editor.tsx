"use client";

/**
 * Kompositions-Editor für E-Mail-Vorlagen (bodyJson als einzige Leinwand).
 *
 * TipTap mit Link (StarterKit), Platzhalter-Pillen und zwei Custom-Nodes:
 *  - `emailGif` (Block, max. 1×): frei platzierbarer Video-GIF-Block
 *  - `emailCta` (Block, mehrfach): CTA-Button mit inline editierbarem
 *    Label + Ziel-URL (`@system:pageUrl` = persönliche Landingpage)
 *
 * Liefert bei jeder Änderung `{ json, html }` — json ist die Quelle für
 * den Renderer, html der Cache/Fallback (bodyHtml-Spalte).
 */

import * as React from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type Editor,
  type NodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Italic,
  Link2,
  Link2Off,
  List,
  MousePointerClick,
  Play,
  Plus,
  Underline as UnderlineIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { asTipTapDoc } from "@/lib/email/render";
import { PlaceholderNode } from "@/components/editor/slide/placeholder-node";

/** Statischer GIF-Platzhalter für Vorschauen (16:9, Play-Button). */
export const EMAIL_GIF_PREVIEW_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="338" viewBox="0 0 600 338"><rect width="600" height="338" rx="14" fill="#1f1d2b"/><circle cx="300" cy="169" r="46" fill="rgba(255,255,255,0.18)"/><path d="M288 145l42 24-42 24z" fill="#ffffff"/><text x="300" y="300" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="15" fill="#a8a3bd">Video-GIF (Vorschau)</text></svg>`,
  );

declare module "@tiptap/core" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    emailGif: {
      insertEmailGif: () => ReturnType;
    };
    emailCta: {
      insertEmailCta: (attrs?: { label?: string; url?: string }) => ReturnType;
    };
  }
}

// ── Custom-Node: Video-GIF (Block, max. 1×) ────────────────────────────────

function EmailGifView() {
  return (
    <NodeViewWrapper data-email-gif="true" className="my-2" draggable="true" data-drag-handle="">
      <div
        contentEditable={false}
        className="flex cursor-grab select-none items-center gap-3 rounded-2xl border-2 border-dashed border-ink/50 bg-ink px-5 py-6 text-white"
      >
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15">
          <Play className="size-4 fill-white text-white" />
        </span>
        <span className="flex flex-col">
          <span className="text-sm font-semibold">Video-GIF</span>
          <span className="text-xs text-white/60">
            Position im Text frei wählbar — pro Empfänger wird hier das
            persönliche Video-GIF eingesetzt.
          </span>
        </span>
      </div>
    </NodeViewWrapper>
  );
}

export const EmailGifNode = Node.create({
  name: "emailGif",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-email-gif]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-email-gif": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmailGifView);
  },

  addCommands() {
    return {
      insertEmailGif:
        () =>
        ({ editor, commands }) => {
          let exists = false;
          editor.state.doc.descendants((n) => {
            if (n.type.name === "emailGif") {
              exists = true;
              return false;
            }
            return true;
          });
          if (exists) return false;
          return commands.insertContent({ type: "emailGif" });
        },
    };
  },
});

// ── Custom-Node: CTA-Button (Block, mehrfach erlaubt) ──────────────────────

function EmailCtaView({ node, updateAttributes, selected }: NodeViewProps) {
  const [open, setOpen] = React.useState(false);
  const label = String(node.attrs.label ?? "");
  const url = String(node.attrs.url ?? "");

  return (
    <NodeViewWrapper data-email-cta="true" className="relative my-2" draggable="true" data-drag-handle="">
      <div contentEditable={false} className="select-none">
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          className={cn(
            "inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3 text-sm font-semibold text-white transition-shadow",
            (selected || open) && "ring-2 ring-brand ring-offset-2",
          )}
          title="Klicken, um Beschriftung und Ziel zu bearbeiten"
        >
          {label || "Video ansehen"}
        </button>
        {open && (
          <div className="absolute left-0 top-full z-20 mt-2 flex w-80 flex-col gap-2.5 rounded-2xl border border-line bg-white p-3.5 shadow-lg">
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-muted">
              Beschriftung
              <input
                value={label}
                onChange={(e) => updateAttributes({ label: e.target.value })}
                className="h-8 rounded-squircle-sm border border-line bg-surface px-2.5 text-sm font-normal text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                placeholder="Video ansehen"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-muted">
              Ziel-URL
              <input
                value={url}
                onChange={(e) => updateAttributes({ url: e.target.value })}
                className="h-8 rounded-squircle-sm border border-line bg-surface px-2.5 text-sm font-normal text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                placeholder="@system:pageUrl"
              />
            </label>
            <p className="text-[11px] leading-relaxed text-ink-muted">
              <code className="rounded bg-surface-soft px-1">@system:pageUrl</code>{" "}
              = persönliche Video-Seite des Empfängers. Alternativ eine feste
              URL eintragen.
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="self-end rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white"
            >
              Fertig
            </button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const EmailCtaNode = Node.create({
  name: "emailCta",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      label: {
        default: "Video ansehen",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-label"),
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
      url: {
        default: "@system:pageUrl",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-url"),
        renderHTML: (attrs) => ({ "data-url": attrs.url }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-email-cta]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-email-cta": "true" }),
      String(node.attrs.label ?? ""),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmailCtaView);
  },

  addCommands() {
    return {
      insertEmailCta:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: "emailCta",
            attrs: {
              label: attrs?.label || "Video ansehen",
              url: attrs?.url || "@system:pageUrl",
            },
          });
        },
    };
  },
});

// ── Editor-Komponente ──────────────────────────────────────────────────────

export interface EmailBodyEditorProps {
  /** Gespeichertes bodyJson (TipTap-Dokument) — hat Vorrang. */
  initialJson: unknown;
  /** bodyHtml-Fallback für Alt-Vorlagen ohne bodyJson. */
  initialHtml: string;
  onChange: (v: { json: unknown; html: string }) => void;
  placeholderSuggestions: string[];
  /** Defaults beim Einfügen eines CTA-Nodes (ctaLabel/ctaUrl-Spalten). */
  ctaDefaults: { label: string; url: string };
}

export function EmailBodyEditor({
  initialJson,
  initialHtml,
  onChange,
  placeholderSuggestions,
  ctaDefaults,
}: EmailBodyEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
        },
      }),
      PlaceholderNode,
      EmailGifNode,
      EmailCtaNode,
    ],
    content:
      (asTipTapDoc(initialJson) as object | null) ?? (initialHtml || ""),
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => {
      onChange({ json: editor.getJSON(), html: editor.getHTML() });
    },
    editorProps: {
      attributes: {
        class:
          "vc-tiptap min-h-[220px] focus:outline-none break-words text-[15px] leading-relaxed",
      },
    },
  });

  if (!editor) {
    return (
      <div className="py-3 text-xs text-ink-muted">Editor wird geladen…</div>
    );
  }

  const hasGif = docHasNode(editor, "emailGif");

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2 rounded-squircle-sm border border-line bg-surface-soft p-2">
        {/* Textformat */}
        <div className="flex items-center gap-1">
          <ToolButton
            aria-label="Fett"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="size-3.5" />
          </ToolButton>
          <ToolButton
            aria-label="Kursiv"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="size-3.5" />
          </ToolButton>
          <ToolButton
            aria-label="Unterstrichen"
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon className="size-3.5" />
          </ToolButton>
          <ToolButton
            aria-label="Aufzählung"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="size-3.5" />
          </ToolButton>
        </div>

        <span className="h-5 w-px bg-line" />

        {/* Link */}
        <LinkControl editor={editor} />

        <span className="h-5 w-px bg-line" />

        {/* Platzhalter */}
        <PlaceholderControl
          editor={editor}
          suggestions={placeholderSuggestions}
        />

        <span className="h-5 w-px bg-line" />

        {/* GIF + CTA */}
        <button
          type="button"
          disabled={hasGif}
          onClick={() => editor.chain().focus().insertEmailGif().run()}
          title={
            hasGif
              ? "Es kann nur ein Video-GIF pro Mail eingefügt werden."
              : undefined
          }
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Play className="size-3" />
          GIF einfügen
        </button>
        <button
          type="button"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertEmailCta({
                label: ctaDefaults.label,
                url: ctaDefaults.url,
              })
              .run()
          }
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          <MousePointerClick className="size-3" />
          CTA-Button einfügen
        </button>
      </div>

      <div className="rounded-squircle-sm border border-line bg-surface p-4">
        <EditorContent editor={editor} />
      </div>
      <p className="text-[11px] text-ink-muted">
        GIF und Button sind optional — einfach dort einfügen, wo sie stehen
        sollen. Eingefügte URLs bleiben als Klartext-Link erhalten.
      </p>
    </div>
  );
}

function docHasNode(editor: Editor, type: string): boolean {
  let exists = false;
  editor.state.doc.descendants((n) => {
    if (n.type.name === type) {
      exists = true;
      return false;
    }
    return true;
  });
  return exists;
}

function ToolButton({
  active,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-full border transition-colors",
        active
          ? "border-brand bg-brand text-white"
          : "border-line bg-surface text-ink-muted hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}

function LinkControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const isActive = editor.isActive("link");
  const selectionEmpty = editor.state.selection.empty;

  function apply() {
    const href = url.trim();
    if (!href) return;
    const withProto = /^(https?:\/\/|mailto:|@system:)/i.test(href)
      ? href
      : `https://${href}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href: withProto }).run();
    setOpen(false);
    setUrl("");
  }

  return (
    <div className="relative flex items-center gap-1">
      <ToolButton
        aria-label="Link setzen"
        active={isActive || open}
        disabled={selectionEmpty && !isActive}
        onClick={() => {
          if (isActive) {
            setUrl(String(editor.getAttributes("link").href ?? ""));
          }
          setOpen((s) => !s);
        }}
        title={
          selectionEmpty && !isActive
            ? "Erst Text markieren, dann verlinken"
            : "Link setzen/bearbeiten"
        }
      >
        <Link2 className="size-3.5" />
      </ToolButton>
      {isActive && (
        <ToolButton
          aria-label="Link entfernen"
          onClick={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            setOpen(false);
          }}
        >
          <Link2Off className="size-3.5" />
        </ToolButton>
      )}
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 flex w-72 items-center gap-2 rounded-2xl border border-line bg-white p-2.5 shadow-lg">
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                apply();
              }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="https://…"
            className="h-8 flex-1 rounded-squircle-sm border border-line bg-surface px-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          />
          <button
            type="button"
            onClick={apply}
            disabled={!url.trim()}
            className="rounded-full bg-brand px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
}

function PlaceholderControl({
  editor,
  suggestions,
}: {
  editor: Editor;
  suggestions: string[];
}) {
  const [open, setOpen] = React.useState(false);
  const [customKey, setCustomKey] = React.useState("");
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold",
          "bg-brand-soft text-brand-deep transition-colors hover:bg-brand/15",
        )}
      >
        <Plus className="size-3" />
        Platzhalter
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 flex w-80 flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-2.5 shadow-lg">
          {suggestions.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                editor.chain().focus().insertPlaceholder({ key }).run();
                setOpen(false);
              }}
              className="rounded-full bg-surface-soft px-2 py-0.5 text-[11px] font-semibold text-ink transition-colors hover:bg-line"
            >
              {`{{${key}}}`}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          <input
            type="text"
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value.replace(/[^\w-]/g, ""))}
            placeholder="eigene_spalte"
            className="h-6 w-28 rounded-full border border-line bg-surface px-2 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          />
          <button
            type="button"
            disabled={!customKey}
            onClick={() => {
              if (!customKey) return;
              editor.chain().focus().insertPlaceholder({ key: customKey }).run();
              setCustomKey("");
              setOpen(false);
            }}
            className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            Einfügen
          </button>
        </div>
      )}
    </div>
  );
}
