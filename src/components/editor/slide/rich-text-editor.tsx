"use client";

import * as React from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";

// TextStyle erweitern um ein fontSize-Attribut, damit
// `setMark("textStyle", { fontSize })` einen inline-style schreibt.
const TextStyleWithSize = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          el.style.fontSize ? el.style.fontSize : null,
        renderHTML: (attrs: { fontSize?: string | null }) =>
          attrs.fontSize
            ? { style: `font-size:${attrs.fontSize}` }
            : {},
      },
    };
  },
});
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Plus,
  Underline as UnderlineIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ensureGoogleFont } from "@/lib/slide/google-fonts-loader";
import { PlaceholderNode } from "./placeholder-node";
import { GoogleFontPicker } from "./google-font-picker";

export interface RichTextEditorProps {
  contentHtml: string;
  onChange: (html: string) => void;
  /** Bekannte Platzhalter-Keys aus CSV/System für die Auto-Vorschläge. */
  placeholderSuggestions: string[];
}

export function RichTextEditor({
  contentHtml,
  onChange,
  placeholderSuggestions,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Wir nehmen unseren eigenen Placeholder-Node
      }),
      Underline,
      TextStyleWithSize,
      Color,
      FontFamily,
      TextAlign.configure({ types: ["paragraph", "heading"] }),
      PlaceholderNode,
    ],
    content: contentHtml,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "vc-tiptap min-h-[60px] focus:outline-none break-words whitespace-pre-wrap",
      },
    },
  });

  // Eingehende Updates (z. B. Layer-Wechsel) → Editor neu befüllen
  React.useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== contentHtml) {
      editor.commands.setContent(contentHtml, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentHtml, editor]);

  if (!editor) {
    return (
      <div className="text-xs text-ink-muted py-3">Editor wird geladen…</div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-squircle-sm border border-line bg-surface-soft p-2">
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
        <span className="mx-1 h-5 w-px bg-line" />
        <ToolButton
          aria-label="Linksbündig"
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft className="size-3.5" />
        </ToolButton>
        <ToolButton
          aria-label="Zentriert"
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter className="size-3.5" />
        </ToolButton>
        <ToolButton
          aria-label="Rechtsbündig"
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight className="size-3.5" />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-line" />
        <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span>Farbe</span>
          <input
            type="color"
            onChange={(e) =>
              editor.chain().focus().setColor(e.target.value).run()
            }
            className="h-6 w-7 cursor-pointer rounded-squircle-sm border border-line bg-surface p-0"
            aria-label="Textfarbe"
          />
        </label>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span>Größe</span>
          <FontSizeInput editor={editor} />
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide">
          Schriftart
        </span>
        <GoogleFontPicker
          value={
            (editor.getAttributes("textStyle").fontFamily as string | null) ??
            null
          }
          onChange={(family) => {
            ensureGoogleFont(family);
            editor.chain().focus().setFontFamily(`"${family}"`).run();
          }}
        />
      </div>

      <PlaceholderInserter
        editor={editor}
        suggestions={placeholderSuggestions}
      />

      <div className="rounded-squircle-sm border border-line bg-surface p-3 min-h-[90px]">
        <EditorContent editor={editor} />
      </div>
      <p className="text-[11px] text-ink-muted">
        Tipp: Markiere Wörter, um Schrift, Farbe und Stil pro Bereich zu setzen.
        Platzhalter sind als Pillen sichtbar.
      </p>
    </div>
  );
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

function FontSizeInput({
  editor,
}: {
  editor: ReturnType<typeof useEditor>;
}) {
  // Tiptap hat keinen built-in FontSize. Wir emulieren über inline-style:
  // span[style="font-size:…"]. Einfacher Approach: ein Number-Input das auf
  // Wechsel den TextStyle-Mark mit Size setzt via setMark.
  const value =
    (editor?.getAttributes("textStyle").fontSize as string | undefined) ?? "";
  const numeric = parseInt(value, 10) || 32;
  return (
    <input
      type="number"
      min={8}
      max={300}
      step={2}
      value={numeric}
      onChange={(e) => {
        const px = `${e.target.value}px`;
        editor?.chain().focus().setMark("textStyle", { fontSize: px }).run();
      }}
      className="h-6 w-14 rounded-squircle-sm border border-line bg-surface px-2 text-xs tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      aria-label="Schriftgröße"
    />
  );
}

function PlaceholderInserter({
  editor,
  suggestions,
}: {
  editor: ReturnType<typeof useEditor>;
  suggestions: string[];
}) {
  const [open, setOpen] = React.useState(false);
  const [customKey, setCustomKey] = React.useState("");
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold",
          "bg-brand-soft text-brand-deep hover:bg-brand/15 transition-colors",
        )}
      >
        <Plus className="size-3" />
        Platzhalter einfügen
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-squircle-sm border border-line bg-surface p-2">
          {suggestions.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                editor?.chain().focus().insertPlaceholder({ key }).run();
              }}
              className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-surface-muted text-ink hover:bg-line transition-colors"
            >
              {`{{${key}}}`}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          <input
            type="text"
            value={customKey}
            onChange={(e) =>
              setCustomKey(e.target.value.replace(/[^\w-]/g, ""))
            }
            placeholder="eigene_spalte"
            className="h-6 w-32 rounded-full border border-line bg-surface px-2 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          />
          <button
            type="button"
            disabled={!customKey}
            onClick={() => {
              if (!customKey) return;
              editor?.chain().focus().insertPlaceholder({ key: customKey }).run();
              setCustomKey("");
            }}
            className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-brand text-white disabled:opacity-50"
          >
            Einfügen
          </button>
        </div>
      )}
    </div>
  );
}
