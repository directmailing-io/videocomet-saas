/**
 * Erkennt Video-URLs gängiger Anbieter und liefert die passende
 * Embed-URL für ein 16:9-iframe. Kein Video-Upload — Sektionen betten
 * ausschließlich fremdgehostete Videos per URL ein (YouTube, Vimeo,
 * Wistia, Loom).
 *
 * YouTube wird über youtube-nocookie.com eingebettet (weniger
 * Tracking auf den Landingpages der Empfänger).
 */

export type VideoProvider = "youtube" | "vimeo" | "wistia" | "loom";

export interface VideoEmbed {
  provider: VideoProvider;
  embedUrl: string;
}

const ID = /^[A-Za-z0-9_-]+$/;

/** null = keine bekannte Video-URL (dann als Bild-/Datei-URL behandeln). */
export function parseVideoEmbed(url: string | undefined): VideoEmbed | null {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  // YouTube: watch?v=ID, youtu.be/ID, /shorts/ID, /embed/ID, /live/ID
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "m.youtube.com") {
    let id = u.searchParams.get("v") ?? "";
    if (!id && ["shorts", "embed", "live"].includes(parts[0] ?? "")) {
      id = parts[1] ?? "";
    }
    if (ID.test(id)) {
      return {
        provider: "youtube",
        embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      };
    }
    return null;
  }
  if (host === "youtu.be") {
    const id = parts[0] ?? "";
    if (ID.test(id)) {
      return {
        provider: "youtube",
        embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      };
    }
    return null;
  }

  // Vimeo: vimeo.com/123456789 oder player.vimeo.com/video/123456789
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parts[0] === "video" ? (parts[1] ?? "") : (parts[0] ?? "");
    if (/^\d+$/.test(id)) {
      return {
        provider: "vimeo",
        embedUrl: `https://player.vimeo.com/video/${id}`,
      };
    }
    return null;
  }

  // Wistia: *.wistia.com/medias/ID oder fast.wistia.net/embed/iframe/ID
  if (host.endsWith("wistia.com") || host.endsWith("wistia.net")) {
    let id = "";
    if (parts[0] === "medias") id = parts[1] ?? "";
    else if (parts[0] === "embed" && parts[1] === "iframe") id = parts[2] ?? "";
    if (ID.test(id)) {
      return {
        provider: "wistia",
        embedUrl: `https://fast.wistia.net/embed/iframe/${id}`,
      };
    }
    return null;
  }

  // Loom: loom.com/share/ID oder loom.com/embed/ID
  if (host === "loom.com") {
    if ((parts[0] === "share" || parts[0] === "embed") && ID.test(parts[1] ?? "")) {
      return {
        provider: "loom",
        embedUrl: `https://www.loom.com/embed/${parts[1]}`,
      };
    }
    return null;
  }

  return null;
}

export const VIDEO_PROVIDER_NAMES: Record<VideoProvider, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  wistia: "Wistia",
  loom: "Loom",
};
