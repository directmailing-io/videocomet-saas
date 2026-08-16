import { describe, expect, it } from "vitest";
import { buildTextReplaceRequests } from "./docs-native-pipeline";

function texts(requests: ReturnType<typeof buildTextReplaceRequests>): string[] {
  return requests.map((r) => r.replaceAllText!.containsText!.text!);
}

describe("buildTextReplaceRequests", () => {
  it("nicht-leere Werte: genau ein Request pro Platzhalter", () => {
    const reqs = buildTextReplaceRequests({ anrede: "Herr", nachname: "Ciecior" });
    expect(texts(reqs)).toEqual(["{{anrede}}", "{{nachname}}"]);
    expect(reqs[0].replaceAllText!.replaceText).toBe("Herr");
  });

  it("leere Werte: erst mit Folge-Leerzeichen, dann führend, dann nackt", () => {
    const reqs = buildTextReplaceRequests({ titel: "" });
    expect(texts(reqs)).toEqual(["{{titel}} ", " {{titel}}", "{{titel}}"]);
    for (const r of reqs) expect(r.replaceAllText!.replaceText).toBe("");
  });

  it("whitespace-only zählt als leer (kein '  Herr' im Brief)", () => {
    const reqs = buildTextReplaceRequests({ titel: "   " });
    expect(texts(reqs)).toEqual(["{{titel}} ", " {{titel}}", "{{titel}}"]);
    expect(reqs[0].replaceAllText!.replaceText).toBe("");
  });

  it("Mix aus leeren und gefüllten Werten behält die Key-Reihenfolge", () => {
    const reqs = buildTextReplaceRequests({ titel: "", anrede: "Herr" });
    expect(texts(reqs)).toEqual([
      "{{titel}} ",
      " {{titel}}",
      "{{titel}}",
      "{{anrede}}",
    ]);
  });

  it("matchCase bleibt aktiv", () => {
    const reqs = buildTextReplaceRequests({ Titel: "Dr." });
    expect(reqs[0].replaceAllText!.containsText!.matchCase).toBe(true);
  });
});
