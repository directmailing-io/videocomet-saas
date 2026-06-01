/**
 * Inline-Preview-Endpoint für eine konkrete Version.
 *
 * GET /api/custom-lp/[id]/versions/[vid]/preview
 *   → returns { html: string }  (~ index.html + all assets inlined as data: URLs)
 *
 * Hintergrund:
 *   Der ältere /api/custom-lp/preview-Endpoint nimmt nur rohes HTML entgegen.
 *   Bei mehrdateiigen Templates (CSS, Fonts, Bilder, JS in eigenen Dateien)
 *   funktionieren relative Pfade in einem srcDoc-Iframe nicht — daher zeigte
 *   die UI bislang "Vorschau nicht direkt verfügbar". Dieser Endpoint löst
 *   das Problem: er holt das vollständige Version-Artefakt aus Bunny und
 *   ersetzt alle relativen Pfade durch Data-URLs.
 *
 * Sicherheit:
 *   - Auth: User muss Template-Owner sein (sonst 403).
 *   - Output ist nur für den Element-Picker / Detail-Page-Iframe gedacht —
 *     kein Cache, kein Index, no-store.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getTemplate, getVersion } from "@/lib/db/queries/custom-lp";
import { readFile } from "@/lib/custom-lp/storage";

const DEMO_LEAD: Record<string, string> = {
  firstName: "Peter",
  lastName: "Müller",
  fullName: "Peter Müller",
  companyName: "Müller GmbH",
  email: "peter.mueller@example.com",
  phone: "+49 30 12345678",
};

function applyPlaceholders(input: string): string {
  return input.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|([^}]*))?\}\}/g,
    (_m, key: string, fallback?: string) => {
      const v = DEMO_LEAD[key];
      if (v && v.length > 0) return v;
      return (fallback ?? "").trim();
    },
  );
}

/**
 * Eine grobe Liste an Mime-Type-Mappings für Asset-Inlining. Nur die
 * Dateitypen, die wir in der Allow-List erlauben (`src/lib/custom-lp/types.ts`).
 */
const MIME: Record<string, string> = {
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

function mimeFor(path: string): string {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

/**
 * Baut für jeden Asset-Pfad eine Data-URL. Text-Formate (CSS/JS) werden mit
 * `;charset=utf-8` ausgeliefert (kein base64 nötig), Binär-Formate als base64.
 * CSS bekommt zusätzlich eine Vor-Verarbeitung, in der ihre eigenen
 * `url(...)`-Referenzen ebenfalls in Data-URLs umgeschrieben werden.
 */
async function buildAssetMap(
  files: Array<{ path: string }>,
  storagePath: string,
  entryHtml: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // CSS-Dateien sammeln wir separat, weil ihre `url()`-Refs noch ersetzt
  // werden müssen NACHDEM die anderen Assets gemappt sind.
  const cssEntries: Array<{ path: string; text: string }> = [];

  for (const f of files) {
    if (f.path === entryHtml) continue;
    const remote = `${storagePath.replace(/\/+$/, "")}/${f.path}`;
    const { buffer } = await readFile(remote);
    const ext = (f.path.split(".").pop() ?? "").toLowerCase();
    if (ext === "css" || ext === "js" || ext === "mjs") {
      // Plain-Text → kein base64, lesbarer + kürzer
      cssEntries.push({
        path: f.path,
        text: buffer.toString("utf-8"),
      });
    } else {
      const mime = mimeFor(f.path);
      const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
      map.set(f.path, dataUrl);
    }
  }

  // CSS-Dateien: ihre url(...)-Refs auf andere Assets umschreiben, dann
  // selber als Data-URL zur Verfügung stellen.
  const binaryEntries = Array.from(map.entries());
  for (const css of cssEntries) {
    let rewritten = css.text;
    for (const [path, dataUrl] of binaryEntries) {
      // url("path"), url('path'), url(path) — und mit ./, /
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(
        `url\\(\\s*(['"]?)(?:\\./|/)?${escaped}\\1\\s*\\)`,
        "g",
      );
      rewritten = rewritten.replace(re, `url("${dataUrl}")`);
    }
    const dataUrl = `data:text/css;charset=utf-8,${encodeURIComponent(
      rewritten,
    )}`;
    map.set(css.path, dataUrl);
  }

  return map;
}

/**
 * Tauscht im HTML alle <link>/<script>/<img>/<source>-Referenzen sowie generell
 * jede Erwähnung eines bekannten Asset-Pfads gegen seine Data-URL aus. Wir
 * sind hier bewusst grobgranular: ein simpler globaler Path-Replace ersetzt
 * jeden String-Vorkommen im HTML — das ist robust und deckt auch obskure
 * Plätze wie `srcset=` oder inline-CSS-`url()` ab.
 */
function inlineAssetsInHtml(
  html: string,
  assetMap: Map<string, string>,
): string {
  // Längere Pfade zuerst, damit "assets/logo.svg" nicht von "logo.svg" geshadowed wird.
  const sorted = Array.from(assetMap.entries()).sort(
    (a, b) => b[0].length - a[0].length,
  );
  let out = html;
  for (const [path, dataUrl] of sorted) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Wir fangen Pfad mit optionalem "./" oder "/" Prefix ab. Die nicht-greedy
    // Lookbehinds sind in V8 supported.
    const re = new RegExp(`(?:\\./|/)?${escaped}`, "g");
    out = out.replace(re, dataUrl);
  }
  return out;
}

/**
 * Stript optionalen `<base href>` (würde Data-URLs brechen) und entfernt
 * Favicon-Links (würden 404-Lärm verursachen).
 */
function lightSanitize(html: string): string {
  return html
    .replace(/<base\s[^>]*>/gi, "")
    .replace(/<link\s[^>]*rel=["']?icon["']?[^>]*>/gi, "");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; vid: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const template = await getTemplate(params.id, auth.user.id);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  let versionRow: Awaited<ReturnType<typeof getVersion>>;
  try {
    versionRow = await getVersion(params.vid, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }
  const version = versionRow.version;
  if (version.templateId !== params.id) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  try {
    // 1) index.html laden
    const entry = version.entryHtml || "index.html";
    const entryRemote = `${version.storagePath.replace(/\/+$/, "")}/${entry}`;
    const { buffer: entryBuf } = await readFile(entryRemote);
    let html = entryBuf.toString("utf-8");

    // 2) Alle anderen Assets als Data-URL-Map aufbauen.
    const assetMap = await buildAssetMap(
      version.fileManifest,
      version.storagePath,
      entry,
    );

    // 3) Asset-Pfade im HTML umschreiben
    html = inlineAssetsInHtml(html, assetMap);

    // 4) Placeholders ({{firstName|...}}) mit Demo-Daten füllen
    html = applyPlaceholders(html);

    // 5) Light-Sanitize
    html = lightSanitize(html);

    return NextResponse.json(
      { html, byteCount: html.length, fileCount: version.fileManifest.length },
      {
        status: 200,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "Vorschau-Generierung fehlgeschlagen.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
