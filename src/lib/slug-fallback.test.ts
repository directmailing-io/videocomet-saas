/**
 * Fallback-Kette von `generateSlug` (Kundenfall contextagentur 2026-08-25):
 * Kampagnen-Template `{companyName}`, aber das CSV hatte keine Firmen-Spalte
 * → alle Leads bekamen `lead-<n>-<hex>` statt eines Namens-Slugs.
 */
import { describe, expect, it } from "vitest";
import { generateSlug } from "@/lib/slug";

describe("generateSlug — Fallback bei leer renderndem Template", () => {
  it("Template ohne passende Daten → Default {firstName}-{lastName} statt lead-N", async () => {
    const slug = await generateSlug({
      template: "{companyName}",
      leadData: { firstName: "Marcel", lastName: "Hofmann", city: "Altenburg" },
      isAvailable: async () => true,
      fallbackId: 0,
    });
    expect(slug).toMatch(/^marcel-hofmann-[a-f0-9]{4}$/);
  });

  it("Default-Fallback nutzt auch deutsche CSV-Aliase (Vorname/Nachname)", async () => {
    const slug = await generateSlug({
      template: "{companyName}",
      leadData: { Vorname: "Petra", Nachname: "Müller" },
      isAvailable: async () => true,
      fallbackId: 3,
    });
    expect(slug).toMatch(/^petra-mueller-[a-f0-9]{4}$/);
  });

  it("gar keine Namensdaten → lead-<fallbackId>-<hex> wie bisher", async () => {
    const slug = await generateSlug({
      template: "{companyName}",
      leadData: { city: "Altenburg" },
      isAvailable: async () => true,
      fallbackId: 0,
    });
    expect(slug).toMatch(/^lead-0-[a-f0-9]{4}$/);
  });
});
