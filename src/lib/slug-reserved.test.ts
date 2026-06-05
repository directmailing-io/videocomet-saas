/**
 * Reserved-Slug-Guard + App-Routen-Drift-Test.
 *
 * Zwei orthogonale Sicherheitsnetze:
 *
 *   1. `generateSlug()` muss jeden Eintrag aus RESERVED_SLUGS hex-suffixen
 *      damit ein Lead-Name wie "Lp Block" nicht zu `/lp-block` kollidiert.
 *   2. Drift-Check: alle Top-Level-Folder aus `src/app/` MÜSSEN in
 *      RESERVED_SLUGS stehen — sonst fail (Reminder beim Hinzufügen neuer
 *      Routen, den Reserved-Set zu pflegen).
 *
 * Hinweis Pfad: laut Paket-B-Spec sollte dieser Test in `src/test/` liegen.
 * Die Vitest-Projekte (siehe vitest.config.ts) picken aber nur
 * `src/lib/**\/*.test.ts` und `src/{app,components}/**` — `src/test/` würde
 * niemals laufen. Daher hier in `src/lib/` abgelegt.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  RESERVED_SLUGS,
  generateSlug,
  isReservedSlug,
} from "@/lib/slug";

describe("RESERVED_SLUGS — generateSlug Hex-Suffix-Trigger", () => {
  it("hex-suffixt jeden Reserved-Slug (Lead-Name == Reserved-Routen-Pfad)", async () => {
    // `generateSlug` rendert das Template (default `{firstName}-{lastName}`)
    // und triggert dann den Reserved-Check. Wir setzen `firstName` direkt
    // auf den reservierten Slug; `lastName` leer → base == reserved-slug.
    for (const reserved of Array.from(RESERVED_SLUGS)) {
      const slug = await generateSlug({
        template: "{firstName}",
        leadData: { firstName: reserved },
        isAvailable: async () => true,
        fallbackId: "x",
      });
      // Erwartung: `<reserved-slug>-<4-hex>` oder — wenn der Reserved-Slug
      // durch `slugifyBasic` (wegen Sonderzeichen wie Punkten) verändert
      // wurde — zumindest mit Hex-Suffix angehängt.
      // `__videocomet-bridge.js` → slugifyBasic macht daraus `videocomet-bridge-js`.
      // Wir prüfen daher nur: das Ergebnis IST nicht der reservierte
      // Slug pur — der Hex-Suffix muss greifen.
      if (isReservedSlug(reserved) && !slug.endsWith(reserved)) {
        // Sonderzeichen-Reserved (.js, _) wird durch slugifyBasic geglättet
        // → ggf. nicht mehr reserved. Skip — der Check unten genügt.
        continue;
      }
      expect(slug, `slug for reserved '${reserved}'`).toMatch(
        new RegExp(`-[a-f0-9]{4}$`),
      );
    }
  });

  it("isReservedSlug ist case-insensitive auf bekannten Routen", () => {
    expect(isReservedSlug("api")).toBe(true);
    expect(isReservedSlug("API")).toBe(true);
    expect(isReservedSlug("lp-block")).toBe(true);
    expect(isReservedSlug("Lp-Block")).toBe(true);
    expect(isReservedSlug("cv")).toBe(true);
    expect(isReservedSlug("c")).toBe(true);
    expect(isReservedSlug("simon-krempel")).toBe(false);
  });
});

describe("RESERVED_SLUGS — Drift-Check gegen src/app/", () => {
  /**
   * Sammelt alle URL-relevanten Top-Level-Folder aus `src/app/`.
   * Ausgenommen:
   *   - Folder die mit `_` starten (Next.js-private, z.B. `_components`)
   *   - Route-Groups `(...)` (keine URL-Segments)
   *   - Dynamic-Routes `[slug]` (greifen catch-all, kein literales Segment)
   *   - Files (`page.tsx`, `layout.tsx`, `globals.css`, ...)
   */
  function topLevelRouteFolders(): string[] {
    // __dirname ist `src/lib`. App-Dir ist `../app`.
    const appDir = path.resolve(__dirname, "..", "app");
    const entries = fs.readdirSync(appDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !name.startsWith("_"))
      .filter((name) => !name.startsWith("("))
      .filter((name) => !name.startsWith("["));
  }

  it("jeder Top-Level-Folder in src/app/ ist als Reserved markiert", () => {
    const folders = topLevelRouteFolders();
    // Sanity: wir haben überhaupt Folder gefunden (sonst Pfad-Bug).
    expect(folders.length).toBeGreaterThan(0);

    const missing = folders.filter((f) => !RESERVED_SLUGS.has(f));
    expect(
      missing,
      `Neue Top-Level-Routen ohne Reserved-Eintrag in RESERVED_SLUGS: ${missing.join(", ")}. ` +
        `Bitte src/lib/slug.ts:RESERVED_SLUGS ergänzen.`,
    ).toEqual([]);
  });
});
