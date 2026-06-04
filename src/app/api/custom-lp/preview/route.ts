/**
 * Temp-Preview-Endpoint für den Upload-Wizard.
 *
 * Use-Case:
 *   Der Kunde lädt ein ZIP hoch und sieht das Ergebnis SOFORT in einem
 *   iframe — bevor wir es überhaupt unter `lp.videocomet.de/<slug>` (Agent B)
 *   ausliefern. Dieser Endpoint nimmt das rohe `index.html` entgegen, ersetzt
 *   Lead-Placeholder durch Demo-Werte, sanitiert grob (entfernt `<script>`-
 *   Tags die das tracking-bridge betreffen würden) und liefert ein
 *   "rewrittenHtml" zurück, das wir in `<iframe srcDoc>` einsetzen.
 *
 * Wir injizieren zusätzlich ein winziges Inspector-Script, das vom Parent-
 * Frame per `postMessage({ type: "vc-inspector-toggle", enabled: true })`
 * an-/ausgeschaltet werden kann. Auf Klick liefert es einen CSS-Selector
 * zurück → Element-Picker.
 *
 * Wichtig: das ist ABSICHTLICH eine sehr leichte Vorschau. Die echte
 * Auslieferung mit allen Assets passiert über Agent Bs Sandbox.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { substitute } from "@/lib/placeholders/substitute";

const previewSchema = z.object({
  html: z.string().min(1).max(2 * 1024 * 1024), // 2 MB cap auf rohem HTML
  /** Demo-Lead-Daten zur Placeholder-Substitution. */
  leadData: z
    .record(z.string(), z.string())
    .optional()
    .default({}),
  /** Wenn `true`, wird das Inspector-Script eingebettet (Default: true). */
  withInspector: z.boolean().optional().default(true),
});

const DEMO_LEAD = {
  firstName: "Peter",
  lastName: "Mueller",
  fullName: "Peter Mueller",
  companyName: "Mueller GmbH",
  email: "peter.mueller@example.com",
  phone: "+49 30 12345678",
};

/**
 * Ersetzt `{{key}}` und `{{key|fallback}}` Placeholder im HTML.
 * Delegiert an die zentrale `substitute()`-Funktion, damit dieselbe
 * Lookup-Logik wie im echten Renderer greift (case-insensitive, Mapping-
 * Auflösung, Fallback). Die Preview kennt KEIN Mapping — sie nutzt die
 * Demo-Lead-Daten direkt.
 */
function applyPlaceholders(
  html: string,
  data: Record<string, string>,
): string {
  return substitute(html, data, undefined, "double-brace-fallback");
}

/**
 * Inspector-Script — wird via srcDoc in den iframe injiziert.
 * Verantwortlich für:
 *   - Hover-Outline
 *   - Klick → CSS-Selector berechnen → postMessage an Parent
 *   - Empfängt {type: "vc-inspector-toggle", enabled} vom Parent
 *
 * Selector-Algorithmus: ID bevorzugt → ansonsten Klassen + nth-of-type,
 * max 5 Ebenen Tiefe.
 */
const INSPECTOR_SCRIPT = `
<script>
(function () {
  var ENABLED = false;
  var outlineEl = null;
  function ensureOutline() {
    if (outlineEl) return outlineEl;
    outlineEl = document.createElement("div");
    outlineEl.style.cssText =
      "position:fixed;pointer-events:none;border:2px solid #6366f1;" +
      "background:rgba(99,102,241,0.12);z-index:2147483646;" +
      "border-radius:4px;transition:all 60ms ease-out;display:none;";
    document.body.appendChild(outlineEl);
    return outlineEl;
  }
  function buildSelector(el) {
    if (!el || el.nodeType !== 1 || el === document.body) return "body";
    if (el.id) return "#" + el.id.replace(/([^a-zA-Z0-9_-])/g, "\\\\$1");
    var path = [];
    var node = el;
    var depth = 0;
    while (node && node !== document.body && depth < 5) {
      var sel = node.tagName.toLowerCase();
      if (node.classList && node.classList.length) {
        var cls = Array.prototype.slice.call(node.classList)
          .filter(function (c) { return !c.startsWith("vc-"); })
          .slice(0, 2)
          .join(".");
        if (cls) sel += "." + cls;
      }
      var parent = node.parentElement;
      if (parent) {
        var same = parent.querySelectorAll(sel);
        if (same.length > 1) {
          var idx = Array.prototype.indexOf.call(parent.children, node) + 1;
          sel += ":nth-child(" + idx + ")";
        }
      }
      path.unshift(sel);
      node = node.parentElement;
      depth++;
    }
    return path.join(" > ") || el.tagName.toLowerCase();
  }
  function onMove(e) {
    if (!ENABLED) return;
    var target = e.target;
    if (!target || target === document.body) {
      ensureOutline().style.display = "none";
      return;
    }
    var r = target.getBoundingClientRect();
    var o = ensureOutline();
    o.style.display = "block";
    o.style.top = r.top + "px";
    o.style.left = r.left + "px";
    o.style.width = r.width + "px";
    o.style.height = r.height + "px";
  }
  function onClick(e) {
    if (!ENABLED) return;
    e.preventDefault();
    e.stopPropagation();
    var sel = buildSelector(e.target);
    var text = (e.target.textContent || "").trim().slice(0, 80);
    var tag = e.target.tagName.toLowerCase();
    parent.postMessage(
      { type: "vc-element-picked", selector: sel, text: text, tag: tag },
      "*",
    );
  }
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (d && d.type === "vc-inspector-toggle") {
      ENABLED = !!d.enabled;
      if (!ENABLED && outlineEl) outlineEl.style.display = "none";
      document.body.style.cursor = ENABLED ? "crosshair" : "";
    }
  });
  // Tell parent we're ready
  parent.postMessage({ type: "vc-inspector-ready" }, "*");
})();
</script>
`;

/**
 * Strip risky / blocking elements aus dem User-HTML für die Preview:
 *   - `<base>`-Tags (würden relative Pfade brechen)
 *   - Cross-origin `<script src>` (würden in srcDoc oft Mixed-Content werfen)
 * Wir tasten KEINE inline-Logik an, da der Picker auf gerendertes DOM
 * angewiesen ist.
 */
function lightSanitize(html: string): string {
  return html
    .replace(/<base\s[^>]*>/gi, "")
    .replace(
      /<link\s[^>]*rel=["']?icon["']?[^>]*>/gi,
      "", // Favicon-Requests vermeiden 404-Lärm
    );
}

/**
 * Bettet das Inspector-Script und einen kleinen Style-Reset ins HTML ein.
 * Vorzugsweise direkt vor `</body>`. Falls kein `</body>` da ist (Fragment),
 * hängen wir es ans Ende an.
 */
function inject(html: string, withInspector: boolean): string {
  let out = lightSanitize(html);
  const overrideStyles =
    '<style id="vc-preview-overrides">' +
    "html,body{margin:0;padding:0}*{box-sizing:border-box}" +
    "</style>";
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, overrideStyles + "</head>");
  } else {
    out = overrideStyles + out;
  }
  if (withInspector) {
    if (/<\/body>/i.test(out)) {
      out = out.replace(/<\/body>/i, INSPECTOR_SCRIPT + "</body>");
    } else {
      out = out + INSPECTOR_SCRIPT;
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let parsed: z.infer<typeof previewSchema>;
  try {
    parsed = previewSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  const merged = { ...DEMO_LEAD, ...parsed.leadData };
  const withPlaceholders = applyPlaceholders(parsed.html, merged);
  const rewrittenHtml = inject(withPlaceholders, parsed.withInspector);

  return NextResponse.json({ rewrittenHtml });
}
