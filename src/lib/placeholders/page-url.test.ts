/**
 * Tests für `buildPageUrlShort()` — Kurz-URL für den globalen
 * `{{pageUrl}}`-Platzhalter (Paket A, Thumbnail-Generator).
 *
 * Vertrag:
 *   - Custom-Domain gesetzt → `<hostname>/<slug>` (kein Protokoll)
 *   - Custom-Domain leer/null → `<stripProtocol(defaultAppUrl)>/v/<slug>`
 *   - Niemals Trailing-Slash, niemals doppelte Slashes
 *   - Hostname wird lowercased, Slug nicht mutiert (kommt schon DB-validiert)
 */
import { describe, expect, it } from "vitest";
import { buildPageUrlShort } from "@/lib/placeholders/page-url";

describe("buildPageUrlShort", () => {
  it("liefert <host>/<slug> für eine Custom-Domain", () => {
    expect(
      buildPageUrlShort(
        "video.digispace.at",
        "simon-krempel",
        "https://app.videocomet.de",
      ),
    ).toBe("video.digispace.at/simon-krempel");
  });

  it("fällt auf default mit /v/<slug> zurück wenn keine Domain", () => {
    expect(
      buildPageUrlShort(null, "anna-meier", "https://app.videocomet.de"),
    ).toBe("app.videocomet.de/v/anna-meier");
  });

  it("entfernt http(s)://-Präfix und Trailing-Slash aus defaultAppUrl", () => {
    expect(buildPageUrlShort("", "x", "https://app.videocomet.de/")).toBe(
      "app.videocomet.de/v/x",
    );
    expect(buildPageUrlShort(null, "y", "http://app.videocomet.de//")).toBe(
      "app.videocomet.de/v/y",
    );
  });

  it("lowercased hostname und trimmt slug + hostname", () => {
    expect(
      buildPageUrlShort(
        "  VIDEO.DIGISPACE.AT/  ",
        "  peter  ",
        "app.videocomet.de",
      ),
    ).toBe("video.digispace.at/peter");
  });

  it("kein Trailing-Slash auch bei leerem Slug", () => {
    expect(
      buildPageUrlShort(
        "video.digispace.at",
        "",
        "https://app.videocomet.de",
      ),
    ).toBe("video.digispace.at");
    expect(buildPageUrlShort(null, "", "https://app.videocomet.de")).toBe(
      "app.videocomet.de",
    );
  });

  it("akzeptiert defaultAppUrl auch ohne Protokoll", () => {
    expect(buildPageUrlShort(null, "foo", "app.videocomet.de")).toBe(
      "app.videocomet.de/v/foo",
    );
  });

  it("worst-case (alle leer) crasht nicht und liefert leere/Slug-only String", () => {
    expect(buildPageUrlShort(null, "", "")).toBe("");
    expect(buildPageUrlShort(null, "lead-x", "")).toBe("/v/lead-x");
  });

  it("akzeptiert Custom-Domain die fälschlich mit Protokoll übergeben wurde", () => {
    expect(
      buildPageUrlShort(
        "https://video.digispace.at",
        "abc",
        "https://app.videocomet.de",
      ),
    ).toBe("video.digispace.at/abc");
  });
});
