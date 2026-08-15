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

export interface MiniMarkdownOptions {
  /**
   * Opt-in (Content-Block): Zeilen, die mit "- " beginnen, werden als
   * Checkliste gerendert — <ul> mit Haekchen-Icons in der Primaerfarbe
   * (--lp-color-primary) statt als Fliesstext-Zeilen. Default aus, damit
   * sich bestehende Blöcke (Rich-Text) nicht verändern.
   */
  checklistBullets?: boolean;
}

const BULLET_RE = /^\s*-\s+(.*)$/;

/** Haekchen-Icon fuer Checklisten-Aufzaehlungen (Token-Farbe). */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="mt-1 size-4 shrink-0"
      style={{ color: "var(--lp-color-primary)" }}
    >
      <path
        d="M4 10.5l4 4 8-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Ein Absatz im Checklisten-Modus: aufeinanderfolgende "- "-Zeilen werden
 * zu einer <ul> gruppiert, alle anderen Zeilen bleiben ein <p> mit <br/>
 * wie im Default-Pfad.
 */
function renderParagraphWithBullets(
  lines: string[],
  pIdx: number,
  ctx: Ctx,
): React.ReactNode {
  type Segment =
    | { kind: "text"; lines: string[] }
    | { kind: "list"; items: string[] };
  const segments: Segment[] = [];
  for (const line of lines) {
    const m = BULLET_RE.exec(line);
    const last = segments[segments.length - 1];
    if (m) {
      if (last && last.kind === "list") last.items.push(m[1]);
      else segments.push({ kind: "list", items: [m[1]] });
    } else {
      if (last && last.kind === "text") last.lines.push(line);
      else segments.push({ kind: "text", lines: [line] });
    }
  }
  return (
    <React.Fragment key={`p-${pIdx}`}>
      {segments.map((seg, sIdx) =>
        seg.kind === "list" ? (
          <ul
            key={`ul-${pIdx}-${sIdx}`}
            className="space-y-2 text-left [&:not(:first-child)]:mt-4"
          >
            {seg.items.map((item, iIdx) => (
              <li
                key={`li-${pIdx}-${sIdx}-${iIdx}`}
                className="flex items-start gap-2.5"
              >
                <CheckIcon />
                <span className="leading-relaxed">{parseInline(item, ctx)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p
            key={`tp-${pIdx}-${sIdx}`}
            className="leading-relaxed [&:not(:first-child)]:mt-4"
          >
            {seg.lines.map((line, lIdx) => (
              <React.Fragment key={`l-${pIdx}-${sIdx}-${lIdx}`}>
                {parseInline(line, ctx)}
                {lIdx < seg.lines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </p>
        ),
      )}
    </React.Fragment>
  );
}

/** Parse a multi-paragraph markdown string into React nodes. */
export function parseMiniMarkdown(
  src: string,
  opts?: MiniMarkdownOptions,
): React.ReactNode {
  const paragraphs = src.replace(/\r\n/g, "\n").split(/\n{2,}/);
  let counter = 0;
  const ctx: Ctx = { nextKey: () => (counter += 1) };
  return paragraphs.map((para, pIdx) => {
    const lines = para.split("\n");
    if (opts?.checklistBullets) {
      return renderParagraphWithBullets(lines, pIdx, ctx);
    }
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
