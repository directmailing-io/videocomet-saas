import * as React from "react";

/**
 * Tiny inline-markdown parser used by the Rich-Text block (and any
 * other block that wants soft markup). Intentionally minimal: until
 * Tiptap lands we only support the subset users actually need.
 *
 * Supported syntax:
 *   **bold**, *italic*, [text](url), [color=#hex|name]…[/color]
 *   blank line -> paragraph, single \n -> <br/>
 *
 * Output is React nodes only — we never set innerHTML, so the renderer
 * remains XSS-safe even when content comes from CSV-imported leads via
 * placeholder substitution.
 */

interface Ctx {
  /** Stable, monotonically increasing key for React lists. */
  nextKey: () => number;
}

function parseInline(text: string, ctx: Ctx): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let buffer = "";
  const flush = () => {
    if (buffer.length > 0) {
      nodes.push(buffer);
      buffer = "";
    }
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === "[") {
      const color = /^\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/.exec(text.slice(i));
      if (color) {
        flush();
        nodes.push(
          <span key={ctx.nextKey()} style={{ color: color[1] }}>
            {parseInline(color[2], ctx)}
          </span>,
        );
        i += color[0].length;
        continue;
      }
      const link = /^\[([^\]]+)\]\(([^)]+)\)/.exec(text.slice(i));
      if (link) {
        flush();
        nodes.push(
          <a
            key={ctx.nextKey()}
            href={link[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {parseInline(link[1], ctx)}
          </a>,
        );
        i += link[0].length;
        continue;
      }
    }

    if (ch === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        flush();
        nodes.push(
          <strong key={ctx.nextKey()}>
            {parseInline(text.slice(i + 2, end), ctx)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }

    if (ch === "*" && text[i + 1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1 && text[end + 1] !== "*") {
        flush();
        nodes.push(
          <em key={ctx.nextKey()}>
            {parseInline(text.slice(i + 1, end), ctx)}
          </em>,
        );
        i = end + 1;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }
  flush();
  return nodes;
}

/** Parse a multi-paragraph markdown string into React nodes. */
export function parseMiniMarkdown(src: string): React.ReactNode {
  const paragraphs = src.replace(/\r\n/g, "\n").split(/\n{2,}/);
  let counter = 0;
  const ctx: Ctx = { nextKey: () => (counter += 1) };
  return paragraphs.map((para, pIdx) => {
    const lines = para.split("\n");
    const children: React.ReactNode[] = [];
    lines.forEach((line, lIdx) => {
      children.push(
        <React.Fragment key={`l-${pIdx}-${lIdx}`}>
          {parseInline(line, ctx)}
        </React.Fragment>,
      );
      if (lIdx < lines.length - 1) {
        children.push(<br key={`br-${pIdx}-${lIdx}`} />);
      }
    });
    return (
      <p
        key={`p-${pIdx}`}
        className="leading-relaxed [&:not(:first-child)]:mt-4"
      >
        {children}
      </p>
    );
  });
}
