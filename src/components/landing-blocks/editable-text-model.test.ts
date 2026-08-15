import { describe, expect, it } from "vitest";
import { deepSet } from "./editable-text";
import {
  parseRawToSegments,
  placeholderLabel,
  serializeSegments,
  type Segment,
} from "./editable-text-model";

/* ------------------------------------------------------------------ */
/* deepSet                                                             */
/* ------------------------------------------------------------------ */

describe("deepSet", () => {
  it("setzt einen flachen Schluessel", () => {
    expect(deepSet({ a: 1 }, "b", "x")).toEqual({ a: 1, b: "x" });
  });

  it("setzt verschachtelte Pfade", () => {
    const out = deepSet({ quote: { text: "alt", author: "A" } }, "quote.text", "neu");
    expect(out).toEqual({ quote: { text: "neu", author: "A" } });
  });

  it("setzt Array-Indizes (items.0.q)", () => {
    const out = deepSet(
      { items: [{ q: "a", a: "x" }, { q: "b" }] },
      "items.0.q",
      "neu",
    );
    expect(out).toEqual({ items: [{ q: "neu", a: "x" }, { q: "b" }] });
  });

  it("legt fehlende Zwischenknoten als Objekt an", () => {
    expect(deepSet({}, "primaryButton.label", "Los")).toEqual({
      primaryButton: { label: "Los" },
    });
  });

  it("legt fehlende Arrays fuer numerische Schluessel an", () => {
    const out = deepSet({}, "items.1.q", "Frage");
    expect(Array.isArray(out.items)).toBe(true);
    expect((out.items as unknown[])[1]).toEqual({ q: "Frage" });
  });

  it("mutiert das Original nicht (Immutabilitaet)", () => {
    const original = { items: [{ q: "a" }], meta: { deep: true } };
    const out = deepSet(original, "items.0.q", "b");
    expect(original.items[0]!.q).toBe("a");
    expect(out).not.toBe(original);
    expect((out.items as unknown[])[0]).not.toBe(original.items[0]);
    // Unberuehrte Zweige duerfen referenzgleich bleiben (structural sharing).
    expect(out.meta).toBe(original.meta);
  });
});

/* ------------------------------------------------------------------ */
/* Chip-Serialisierung: raw → Segmente → raw                           */
/* ------------------------------------------------------------------ */

describe("parseRawToSegments", () => {
  it("reiner Text ergibt ein Text-Segment", () => {
    expect(parseRawToSegments("Hallo Welt")).toEqual([
      { type: "text", text: "Hallo Welt" },
    ]);
  });

  it("leerer String ergibt keine Segmente", () => {
    expect(parseRawToSegments("")).toEqual([]);
  });

  it("zerlegt Platzhalter ohne Fallback", () => {
    expect(parseRawToSegments("Hallo {{firstName}}!")).toEqual([
      { type: "text", text: "Hallo " },
      { type: "placeholder", key: "firstName" },
      { type: "text", text: "!" },
    ]);
  });

  it("zerlegt Platzhalter mit Fallback (inkl. Leerzeichen)", () => {
    expect(parseRawToSegments("{{firstName|Lieber Kunde}}, hi")).toEqual([
      { type: "placeholder", key: "firstName", fallback: "Lieber Kunde" },
      { type: "text", text: ", hi" },
    ]);
  });

  it("toleriert Whitespace um den Key", () => {
    expect(parseRawToSegments("{{ firstName }}")).toEqual([
      { type: "placeholder", key: "firstName" },
    ]);
  });

  it("behandelt leeren Fallback wie keinen Fallback", () => {
    expect(parseRawToSegments("{{firstName|}}")).toEqual([
      { type: "placeholder", key: "firstName" },
    ]);
  });

  it("laesst ungueltige Marker als Text stehen", () => {
    expect(parseRawToSegments("a {{}} b")).toEqual([
      { type: "text", text: "a {{}} b" },
    ]);
  });

  it("unterstuetzt mehrere Platzhalter und Zeilenumbrueche", () => {
    expect(
      parseRawToSegments("Hi {{firstName}},\nGruesse an {{company|dein Team}}."),
    ).toEqual([
      { type: "text", text: "Hi " },
      { type: "placeholder", key: "firstName" },
      { type: "text", text: ",\nGruesse an " },
      { type: "placeholder", key: "company", fallback: "dein Team" },
      { type: "text", text: "." },
    ]);
  });
});

describe("serializeSegments", () => {
  it("serialisiert Segmente zurueck in den Rohtext", () => {
    const segments: Segment[] = [
      { type: "text", text: "Hallo " },
      { type: "placeholder", key: "firstName", fallback: "du" },
      { type: "text", text: "!" },
    ];
    expect(serializeSegments(segments)).toBe("Hallo {{firstName|du}}!");
  });

  it("Roundtrip: raw → Segmente → raw ist stabil", () => {
    const raws = [
      "Hallo {{firstName}}!",
      "{{firstName|Lieber Kunde}}, willkommen bei {{company}}.",
      "Zeile 1\nZeile 2 mit {{jobTitle|Titel}}",
      "**Fett** und - Liste mit {{firstName}}",
      "Ohne Platzhalter, nur Text.",
      "",
    ];
    for (const raw of raws) {
      expect(serializeSegments(parseRawToSegments(raw))).toBe(raw);
    }
  });

  it("Roundtrip normalisiert Whitespace im Marker", () => {
    expect(serializeSegments(parseRawToSegments("{{ firstName }}"))).toBe(
      "{{firstName}}",
    );
  });
});

describe("placeholderLabel", () => {
  const placeholders = [{ key: "firstName", label: "Vorname des Leads" }];

  it("liefert das Klartext-Label bekannter Keys", () => {
    expect(placeholderLabel("firstName", placeholders)).toBe(
      "Vorname des Leads",
    );
  });

  it("faellt bei unbekannten Keys auf den Key zurueck", () => {
    expect(placeholderLabel("customField", placeholders)).toBe("customField");
  });
});
