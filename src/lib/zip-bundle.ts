/**
 * Streaming ZIP bundler used by the run pdf-bundle endpoint.
 *
 * Uses `archiver` to pipe arbitrary file inputs into a single ZIP without
 * buffering everything in memory. Remote sources (URLs) are streamed via
 * `fetch` and piped straight into the archive.
 */

import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import archiver from "archiver";

export interface ZipEntry {
  name: string;
  source: Readable | Buffer | string;
}

/**
 * Creates a Node Readable that emits a ZIP stream of the given entries.
 *
 * Entries are appended sequentially. The returned stream may be piped into
 * a `Response`'s body or another sink. Any archiver error rejects the
 * resulting promise; the stream is automatically finalized.
 */
export function createZipStream(entries: ZipEntry[]): Readable {
  const archive = archiver("zip", { zlib: { level: 6 } });
  const out = new PassThrough();
  archive.pipe(out);

  // Append each entry. Streams added here are consumed by archiver as it
  // builds the ZIP, so we don't need to await per-entry.
  for (const entry of entries) {
    if (Buffer.isBuffer(entry.source) || typeof entry.source === "string") {
      archive.append(entry.source, { name: entry.name });
    } else {
      archive.append(entry.source, { name: entry.name });
    }
  }

  // Kick off finalization; errors propagate via the 'error' event below.
  archive.finalize().catch((err) => {
    out.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  archive.on("error", (err) => {
    out.destroy(err);
  });
  archive.on("warning", (err) => {
    // Bad-archive warnings (e.g. unknown encoding) shouldn't kill the
    // stream; surface anything fatal via 'error' above.
    if (err.code !== "ENOENT") {
      // eslint-disable-next-line no-console
      console.warn("[zip] warning:", err.message);
    }
  });

  return out;
}

/**
 * Streams a remote URL into the archive under the given name.
 *
 * Errors fetching the URL are appended to the archive as a manifest entry
 * so the resulting ZIP is never silently incomplete.
 */
export async function addRemoteFileToZip(
  archive: archiver.Archiver,
  name: string,
  url: string,
): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      archive.append(
        `Fetch fehlgeschlagen: HTTP ${res.status} fuer ${url}\n`,
        { name: `${name}.error.txt` },
      );
      return;
    }
    // Convert Web ReadableStream to Node Readable.
    const node = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream);
    const pass = new PassThrough();
    archive.append(pass, { name });
    await pipeline(node, pass);
  } catch (err) {
    archive.append(
      `Fehler beim Laden von ${url}: ${err instanceof Error ? err.message : String(err)}\n`,
      { name: `${name}.error.txt` },
    );
  }
}

/**
 * Lower-level helper for callers that want full control over an archive
 * (e.g. mixing remote URLs + manifest CSV). Returns the archiver instance
 * + output stream; caller is responsible for `archive.finalize()`.
 */
export function createArchive(): {
  archive: archiver.Archiver;
  stream: Readable;
} {
  const archive = archiver("zip", { zlib: { level: 6 } });
  const out = new PassThrough();
  archive.pipe(out);
  archive.on("error", (err) => out.destroy(err));
  return { archive, stream: out };
}
