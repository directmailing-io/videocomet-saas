import { describe, expect, it } from "vitest";
import { friendlyScreenshotError } from "./screenshot-error-text";

describe("friendlyScreenshotError", () => {
  it("übersetzt ERR_NAME_NOT_RESOLVED (Daniels Screenshot-Fall)", () => {
    expect(
      friendlyScreenshotError(
        "net::ERR_NAME_NOT_RESOLVED at https://videocomet/",
      ),
    ).toBe(
      "Diese Adresse wurde nicht gefunden. Prüfe die Schreibweise, zum Beispiel firma.de",
    );
  });

  it("übersetzt Verbindungs- und Timeout-Fehler", () => {
    expect(
      friendlyScreenshotError("net::ERR_CONNECTION_REFUSED at https://x.de/"),
    ).toBe("Die Webseite hat nicht geantwortet. Bitte versuche es erneut.");
    expect(
      friendlyScreenshotError(
        "TimeoutError: Navigation timeout of 30000 ms exceeded",
      ),
    ).toBe("Die Webseite hat nicht geantwortet. Bitte versuche es erneut.");
  });

  it("übersetzt Zertifikatsfehler", () => {
    expect(
      friendlyScreenshotError("net::ERR_CERT_COMMON_NAME_INVALID"),
    ).toBe(
      "Die Webseite hat ein Sicherheitsproblem (Zertifikat). Prüfe die Adresse.",
    );
  });

  it("übersetzt HTTP 403/404-Muster", () => {
    expect(friendlyScreenshotError("http 403")).toBe(
      "Die Webseite blockiert automatische Zugriffe. Versuche es erneut oder wähle eine andere Seite.",
    );
    expect(friendlyScreenshotError("HTTP 404")).toBe(
      "Diese Seite wurde nicht gefunden. Prüfe die Adresse.",
    );
  });

  it("fällt bei unbekannten technischen Meldungen auf den generischen Text zurück", () => {
    expect(
      friendlyScreenshotError("Protocol error (Page.captureScreenshot): x"),
    ).toBe(
      "Die Webseite konnte nicht geladen werden. Prüfe die Adresse und versuche es erneut.",
    );
    expect(friendlyScreenshotError("")).toBe(
      "Die Webseite konnte nicht geladen werden. Prüfe die Adresse und versuche es erneut.",
    );
    expect(friendlyScreenshotError(undefined)).toBe(
      "Die Webseite konnte nicht geladen werden. Prüfe die Adresse und versuche es erneut.",
    );
  });

  it("reicht bereits freundliche deutsche Meldungen unverändert durch", () => {
    const friendly =
      "Vorschau-Erzeugung dauerte zu lange. Der Worker antwortet nicht.";
    expect(friendlyScreenshotError(friendly)).toBe(friendly);
    expect(friendlyScreenshotError("Keine URL hinterlegt.")).toBe(
      "Keine URL hinterlegt.",
    );
  });
});
