import * as React from "react";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";
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
  if (!filled.trim()) return null;

  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "md", maxWidth: "normal", alignment: "left" }}
      innerClassName="text-base sm:text-lg"
    >
      {parseMiniMarkdown(filled)}
    </BlockFrame>
  );
}
