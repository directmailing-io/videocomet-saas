import { beforeEach, describe, expect, it } from "vitest";
import { isPrivateStorageUrl, presentMediaItem, presentStorageUrl } from "./private-storage";

describe("private-storage", () => {
  beforeEach(() => {
    process.env.BUNNY_STORAGE_CDN_HOSTNAME = "videocomet-pdf.b-cdn.net";
    process.env.BUNNY_STORAGE_TOKEN_AUTH_KEY = "test-key-1234";
  });

  it("erkennt nur die geschützten Ordner auf der eigenen Zone", () => {
    expect(isPrivateStorageUrl("https://videocomet-pdf.b-cdn.net/users/abc/webcam/x.webm")).toBe(true);
    expect(isPrivateStorageUrl("https://videocomet-pdf.b-cdn.net/webcams/abc/x.mp4")).toBe(true);
    expect(isPrivateStorageUrl("https://videocomet-pdf.b-cdn.net/intro/abc/sample.wav")).toBe(true);
    expect(isPrivateStorageUrl("https://videocomet-pdf.b-cdn.net/thumbnails/r/l.png")).toBe(false);
    expect(isPrivateStorageUrl("https://videocomet-pdf.b-cdn.net/email-gifs/c/l.gif")).toBe(false);
    expect(isPrivateStorageUrl("https://videocomet-pdf.b-cdn.net/runs/r/leads/l.pdf")).toBe(false);
    expect(isPrivateStorageUrl("https://videocomet-pdf.b-cdn.net/users/abc/media/x.mp4")).toBe(false);
    expect(isPrivateStorageUrl("https://vz-9c44b476-07a.b-cdn.net/guid/playlist.m3u8")).toBe(false);
    expect(isPrivateStorageUrl("not a url")).toBe(false);
    expect(isPrivateStorageUrl(null)).toBe(false);
  });

  it("signiert private URLs mit token+expires, lässt öffentliche unverändert", () => {
    const pub = "https://videocomet-pdf.b-cdn.net/thumbnails/r/l.png";
    expect(presentStorageUrl(pub)).toBe(pub);
    const priv = "https://videocomet-pdf.b-cdn.net/users/abc/webcam/x.webm";
    const signed = new URL(presentStorageUrl(priv, 600));
    expect(signed.hostname).toBe("videocomet-pdf.b-cdn.net");
    expect(signed.pathname).toBe("/users/abc/webcam/x.webm");
    expect(signed.searchParams.get("token")).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const exp = Number(signed.searchParams.get("expires"));
    expect(exp).toBeGreaterThan(Date.now() / 1000 + 500);
  });

  it("signiert nicht doppelt", () => {
    const priv = "https://videocomet-pdf.b-cdn.net/intro/abc/a.wav";
    const once = presentStorageUrl(priv);
    const twice = new URL(presentStorageUrl(once));
    expect(twice.searchParams.getAll("token")).toHaveLength(1);
    expect(twice.searchParams.getAll("expires")).toHaveLength(1);
  });

  it("ohne Key: unverändert (kein Crash)", () => {
    delete process.env.BUNNY_STORAGE_TOKEN_AUTH_KEY;
    const priv = "https://videocomet-pdf.b-cdn.net/intro/abc/a.wav";
    expect(presentStorageUrl(priv)).toBe(priv);
  });

  it("presentMediaItem lässt andere Felder unangetastet", () => {
    const item = { id: "1", publicUrl: "https://videocomet-pdf.b-cdn.net/webcams/u/x.mp4", name: "n" };
    const out = presentMediaItem(item);
    expect(out.id).toBe("1");
    expect(out.publicUrl).toContain("token=");
  });
});
