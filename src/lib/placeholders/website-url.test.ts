import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEBSITE_URL_KEY,
  slugifyUrlColumn,
  websiteSegmentMappingKey,
} from "./website-url";

describe("slugifyUrlColumn", () => {
  it("erzeugt lowercase-Slugs mit transliterierten Umlauten", () => {
    expect(slugifyUrlColumn("Karriereseite")).toBe("karriereseite");
    expect(slugifyUrlColumn("Über uns")).toBe("ueber-uns");
    expect(slugifyUrlColumn("Größen-Tabelle (PDF)")).toBe(
      "groessen-tabelle-pdf",
    );
  });

  it("liefert leeren String für unbrauchbare Namen", () => {
    expect(slugifyUrlColumn("   ")).toBe("");
    expect(slugifyUrlColumn("!!!")).toBe("");
  });
});

describe("websiteSegmentMappingKey", () => {
  it("nutzt urlColumn, sonst den Default-Key", () => {
    expect(websiteSegmentMappingKey({ urlColumn: "karriereseite" })).toBe(
      "karriereseite",
    );
    expect(websiteSegmentMappingKey({ urlColumn: "" })).toBe(
      DEFAULT_WEBSITE_URL_KEY,
    );
    expect(websiteSegmentMappingKey({ urlColumn: "  " })).toBe(
      DEFAULT_WEBSITE_URL_KEY,
    );
  });
});
