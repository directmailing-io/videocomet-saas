/**
 * Tiptap-Extension für Platzhalter als visuelle Pillen.
 *
 * Im Editor: <span data-placeholder="key" class="vc-placeholder">{{key}}</span>
 * — als atomarer Inline-Node, nicht selektierbar via Text-Cursor (Klick
 * selektiert die ganze Node).
 *
 * Beim Speichern liefert Tiptap genau diese Spans im HTML. Der Worker
 * ersetzt sie via `resolvePlaceholders()` durch die Lead-Werte.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export interface PlaceholderOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    placeholder: {
      insertPlaceholder: (attrs: {
        key: string;
        fallback?: string;
      }) => ReturnType;
    };
  }
}

export const PlaceholderNode = Node.create<PlaceholderOptions>({
  name: "placeholder",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      key: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-placeholder"),
        renderHTML: (attrs) => ({ "data-placeholder": attrs.key }),
      },
      fallback: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-fallback"),
        renderHTML: (attrs) =>
          attrs.fallback ? { "data-fallback": attrs.fallback } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-placeholder]",
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const key = (node.attrs.key as string) || "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "vc-placeholder",
      }),
      `{{${key}}}`,
    ];
  },

  addCommands() {
    return {
      insertPlaceholder:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: "placeholder",
            attrs: { key: attrs.key, fallback: attrs.fallback ?? null },
          });
        },
    };
  },
});
