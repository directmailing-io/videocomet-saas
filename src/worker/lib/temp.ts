/**
 * Tmp-file manager.
 *
 * Each lead-job gets its own ephemeral working directory under the OS tmp
 * folder. The directory is removed at the end of the job (success OR error)
 * by the pipeline orchestrator via `cleanupTempDir`.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Creates a fresh tmp directory and returns its absolute path.
 * Prefix is sanitised to avoid path-injection.
 */
export async function createTempDir(prefix: string): Promise<string> {
  const safe = prefix.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
  const base = join(tmpdir(), `videocomet-${safe}-`);
  return mkdtemp(base);
}

/**
 * Removes a directory and all its contents. Swallows ENOENT so calling this
 * twice (e.g. retry path) won't blow up.
 */
export async function cleanupTempDir(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[worker:temp] cleanup failed for ${path}:`, err);
  }
}
