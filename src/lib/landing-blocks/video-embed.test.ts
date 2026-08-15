import { describe, expect, it } from "vitest";

import { parseVideoEmbed } from "./video-embed";

describe("parseVideoEmbed", () => {
  it("erkennt YouTube in allen gängigen Formen (nocookie-Embed)", () => {
    const expected = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?t=10",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ]) {
      expect(parseVideoEmbed(url)).toEqual({
        provider: "youtube",
        embedUrl: expected,
      });
    }
  });

  it("erkennt Vimeo, Wistia und Loom", () => {
    expect(parseVideoEmbed("https://vimeo.com/123456789")?.embedUrl).toBe(
      "https://player.vimeo.com/video/123456789",
    );
    expect(
      parseVideoEmbed("https://firma.wistia.com/medias/abc123xyz")?.embedUrl,
    ).toBe("https://fast.wistia.net/embed/iframe/abc123xyz");
    expect(
      parseVideoEmbed("https://www.loom.com/share/0abc123def")?.embedUrl,
    ).toBe("https://www.loom.com/embed/0abc123def");
  });

  it("lehnt fremde/kaputte URLs und Nicht-Video-Links ab", () => {
    for (const url of [
      "",
      "kein-link",
      "https://example.com/video.mp4",
      "https://youtube.com/watch?v=<script>",
      "javascript:alert(1)",
      "https://vimeo.com/nicht-numerisch",
    ]) {
      expect(parseVideoEmbed(url)).toBeNull();
    }
  });
});
