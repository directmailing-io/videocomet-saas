import { describe, expect, it } from "vitest";

import { extFromMime, sniffImage, svgIsDangerous } from "./upload-sniff";

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 "),
]);

describe("sniffImage", () => {
  it("erkennt PNG, JPEG und WebP per Magic Bytes", () => {
    expect(sniffImage(PNG_HEADER)).toEqual({ mime: "image/png", ext: "png" });
    expect(sniffImage(JPEG_HEADER)).toEqual({ mime: "image/jpeg", ext: "jpg" });
    expect(sniffImage(WEBP_HEADER)).toEqual({
      mime: "image/webp",
      ext: "webp",
    });
  });

  it("erkennt harmlose SVGs (auch mit XML-Deklaration/Kommentar/Doctype)", () => {
    const svg = `<?xml version="1.0"?><!-- Logo --><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>`;
    expect(sniffImage(Buffer.from(svg))).toEqual({
      mime: "image/svg+xml",
      ext: "svg",
    });
  });

  it("lehnt gefährliche SVGs ab (Script, Event-Handler, foreignObject)", () => {
    for (const svg of [
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
      `<svg onload="alert(1)"></svg>`,
      `<svg><foreignObject><body>hi</body></foreignObject></svg>`,
      `<svg><a href="javascript:alert(1)">x</a></svg>`,
    ]) {
      expect(sniffImage(Buffer.from(svg))).toBeNull();
    }
  });

  it("lehnt HTML und beliebige Binärdaten ab", () => {
    expect(sniffImage(Buffer.from("<!DOCTYPE html><html><body>x</body></html>"))).toBeNull();
    expect(sniffImage(Buffer.from("<h1>hi</h1> kein bild hier"))).toBeNull();
    expect(
      sniffImage(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b])),
    ).toBeNull();
  });
});

describe("svgIsDangerous", () => {
  it("erlaubt normale Vektor-Inhalte", () => {
    expect(
      svgIsDangerous(`<svg><path d="M0 0 L10 10" fill="#f00"/></svg>`),
    ).toBe(false);
  });

  it("erkennt data:text/html-Nachladen", () => {
    expect(
      svgIsDangerous(`<svg><image href="data:text/html;base64,x"/></svg>`),
    ).toBe(true);
  });
});

describe("extFromMime", () => {
  it("leitet die Endung aus dem MIME-Typ ab (inkl. Codec-Parametern)", () => {
    expect(extFromMime("image/png")).toBe("png");
    expect(extFromMime("video/webm;codecs=vp8,opus")).toBe("webm");
    expect(extFromMime("video/quicktime")).toBe("mov");
  });

  it("liefert null für unbekannte Typen", () => {
    expect(extFromMime("text/html")).toBeNull();
    expect(extFromMime("application/octet-stream")).toBeNull();
  });
});
