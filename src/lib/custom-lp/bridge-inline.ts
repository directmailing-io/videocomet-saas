/**
 * Lädt die Tracking-Bridge zur Build-/Runtime-Zeit einmalig vom Dateisystem
 * und cached den String im Modul-Scope. Damit kann der LP-Renderer den Code
 * DIREKT als `<script>...</script>` ins HTML einbetten — kein externes
 * Script-Tag, kein zusätzlicher HTTP-Request, AdBlocker können nichts blocken
 * (sie blocken Requests, nicht inline-Code).
 *
 * Plus: wir patchen die hard-codierte TRACK_ENDPOINT-Konstante zur Runtime
 * von `https://app.videocomet.de/api/track/event` auf den same-origin Pfad
 * `/_e`. Damit POSTet die Bridge zum gleichen Host wie die LP läuft —
 * first-party, kein cross-origin, kein CORS-Trigger.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

let cachedSource: string | null = null;
let cachedHash: string | null = null;

const BRIDGE_PATH_PARTS = ["public", "__videocomet-bridge.js"];

/**
 * Override des Tracking-Endpoints im Bridge-Source. Der same-origin Pfad
 * `/_e` wird von `src/app/_e/route.ts` (Alias für `/api/track/event`)
 * bedient. Wenn wir den Bridge-Code je umstrukturieren, MUSS dieser
 * Replace weiter funktionieren — der Test-Match ist sehr eng.
 */
const ENDPOINT_PATTERN =
  /var\s+TRACK_ENDPOINT\s*=\s*"https?:\/\/[^"]+\/api\/track\/event"\s*;/;
const ENDPOINT_REPLACEMENT = 'var TRACK_ENDPOINT = "/_e";';

function loadBridgeSource(): string {
  const path = join(process.cwd(), ...BRIDGE_PATH_PARTS);
  const raw = readFileSync(path, "utf-8");
  if (!ENDPOINT_PATTERN.test(raw)) {
    throw new Error(
      "[bridge-inline] Konnte TRACK_ENDPOINT in __videocomet-bridge.js " +
        "nicht finden — Source-Format hat sich geändert; Pattern updaten.",
    );
  }
  return raw.replace(ENDPOINT_PATTERN, ENDPOINT_REPLACEMENT);
}

/**
 * Liefert den Bridge-Quelltext als String, bereit zum direkten Einbetten
 * in ein `<script>...</script>`-Tag. Caching: Erstaufruf liest Datei,
 * danach reine String-Returns.
 */
export function getInlineBridgeSource(): string {
  if (cachedSource === null) {
    cachedSource = loadBridgeSource();
  }
  return cachedSource;
}

/**
 * Ein kurzer Hash des Bridge-Source — nützlich falls wir später eine
 * CSP-Hash-Whitelist nutzen statt `unsafe-inline`. Heute keine Pflicht.
 */
export function getInlineBridgeHash(): string {
  if (cachedHash === null) {
    // Lazy, da crypto-Import nicht überall billig ist.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    cachedHash = createHash("sha256")
      .update(getInlineBridgeSource())
      .digest("base64");
  }
  return cachedHash;
}
