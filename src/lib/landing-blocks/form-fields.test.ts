import { describe, expect, it } from "vitest";

import { asFormFields, MAX_FIELD_OPTIONS } from "./form-fields";

describe("asFormFields — Auswahlfelder", () => {
  it("parst select/multiselect samt bereinigten Optionen", () => {
    const fields = asFormFields([
      {
        id: "a",
        label: "Thema",
        type: "select",
        required: true,
        options: [" Beratung ", "", "Demo", 42],
      },
      { id: "b", label: "Interessen", type: "multiselect", options: ["X"] },
    ]);
    expect(fields).toEqual([
      {
        id: "a",
        label: "Thema",
        type: "select",
        required: true,
        prefillKey: undefined,
        options: ["Beratung", "Demo"],
      },
      {
        id: "b",
        label: "Interessen",
        type: "multiselect",
        required: false,
        prefillKey: undefined,
        options: ["X"],
      },
    ]);
  });

  it("ignoriert Optionen bei Nicht-Auswahl-Typen und unbekannte Typen werden text", () => {
    const fields = asFormFields([
      { id: "a", label: "Frei", type: "upload", options: ["A"] },
    ]);
    expect(fields?.[0]?.type).toBe("text");
    expect(fields?.[0]?.options).toBeUndefined();
  });

  it("kappt Optionen bei MAX_FIELD_OPTIONS", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Option ${i}`);
    const fields = asFormFields([
      { id: "a", label: "Viele", type: "select", options: many },
    ]);
    expect(fields?.[0]?.options).toHaveLength(MAX_FIELD_OPTIONS);
  });
});
