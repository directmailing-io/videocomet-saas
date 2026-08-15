import * as React from "react";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";
import { EditableText, MaybeEmptyField } from "./editable-text";
import { parseMiniMarkdown } from "./mini-markdown";

/**
 * Rich-Text block — wraps the mini-markdown parser. Inline-only syntax
 * for now (**bold**, *italic*, links, [color]); the full Tiptap editor
 * arrives in a later iteration.
 *
 * data shape: { markdown: string }
 */
export function BlockRichText({
  data,
  style,
  leadData,
}: BlockRenderProps): React.ReactElement | null {
  const raw = typeof data.markdown === "string" ? data.markdown : "";
  const filled = renderPlaceholders(raw, leadData);

  const frame = (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "md", maxWidth: "normal", alignment: "left" }}
      innerClassName="text-base sm:text-lg"
    >
      <EditableText
        path="markdown"
        raw={raw}
        multiline
        markdown
        emptyHint="Text eingeben"
      >
        {parseMiniMarkdown(filled)}
      </EditableText>
    </BlockFrame>
  );

  if (!filled.trim()) {
    // Public: unveraendert null. Im Builder: leeres Feld mit Hint.
    return <MaybeEmptyField present={false}>{frame}</MaybeEmptyField>;
  }
  return frame;
}
