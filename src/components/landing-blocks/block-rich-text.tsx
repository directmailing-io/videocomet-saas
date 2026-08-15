import * as React from "react";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";
import { EditableText, MaybeEmptyField } from "./editable-text";
import { parseMiniMarkdown } from "./mini-markdown";

function markdownField(raw: string, filled: string): React.ReactElement {
  return (
    <EditableText
      path="markdown"
      raw={raw}
      multiline
      markdown
      emptyHint="Text eingeben"
    >
      {parseMiniMarkdown(filled)}
    </EditableText>
  );
}

/**
 * Rich-Text block — wraps the mini-markdown parser. Inline-only syntax
 * for now (**bold**, *italic*, links, [color]); the full Tiptap editor
 * arrives in a later iteration.
 *
 * data shape: { markdown: string, headline?: string, alignment?: "left"|"center" }
 */
export function BlockRichText({
  data,
  style,
  leadData,
}: BlockRenderProps): React.ReactElement | null {
  const raw = typeof data.markdown === "string" ? data.markdown : "";
  const filled = renderPlaceholders(raw, leadData);
  const rawHeadline = typeof data.headline === "string" ? data.headline : "";
  const headline = renderPlaceholders(rawHeadline, leadData);
  const alignment = data.alignment === "center" ? "center" : ("left" as const);

  const frame = (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "md", maxWidth: "normal", alignment }}
      innerClassName="text-base sm:text-lg"
    >
      <MaybeEmptyField present={!!headline.trim()}>
        <h2
          className="text-2xl sm:text-3xl font-bold tracking-tight text-balance"
          style={{ fontFamily: "var(--lp-font-heading)" }}
        >
          <EditableText
            path="headline"
            raw={rawHeadline}
            emptyHint="Überschrift eingeben (optional)"
          >
            {headline}
          </EditableText>
        </h2>
      </MaybeEmptyField>
      <MaybeEmptyField present={!!filled.trim()}>
        {headline.trim() ? (
          <div className="mt-4">{markdownField(raw, filled)}</div>
        ) : (
          markdownField(raw, filled)
        )}
      </MaybeEmptyField>
    </BlockFrame>
  );

  if (!filled.trim() && !headline.trim()) {
    // Public: unveraendert null. Im Builder: leeres Feld mit Hint.
    return <MaybeEmptyField present={false}>{frame}</MaybeEmptyField>;
  }
  return frame;
}
