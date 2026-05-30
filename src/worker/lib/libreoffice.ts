/**
 * LibreOffice headless DOCX-to-PDF wrapper.
 *
 * Spawns `libreoffice --headless --convert-to pdf --outdir <dir> <input>`.
 * The output filename is the input basename with the extension replaced.
 *
 * LibreOffice occasionally crashes under load. We retry once with the
 * `soffice` alias which sometimes routes through a slightly different
 * profile-init path.
 *
 * Parallelism: LibreOffice is normally single-instance per user-profile
 * dir (the profile directory holds an exclusive lock file). The historical
 * fix here was a global in-process mutex (`withLibreOfficeLock`) which
 * serialized ALL conversions across the worker — fine at concurrency=4 but
 * a hard bottleneck once we bumped workers to 8. The fix is to spawn each
 * LibreOffice instance with its own ephemeral user-profile directory via
 * `-env:UserInstallation=file:///tmp/lo-profile-<uuid>`. Each profile costs
 * a few MB of disk + ~200MB resident RSS during the conversion and is
 * cleaned up immediately afterwards. No global mutex is needed any more.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { stat, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 90_000;

function defaultBinary(): string {
  return process.env.LIBREOFFICE_PATH ?? "/usr/bin/libreoffice";
}

/**
 * Allocate a fresh per-conversion user-profile dir. Returned as the absolute
 * filesystem path (caller will pass the `file://` form to LibreOffice).
 * Lives under the OS tmp dir so it gets reaped on reboot if cleanup fails.
 */
async function createProfileDir(): Promise<string> {
  const dir = join(tmpdir(), `lo-profile-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Best-effort cleanup: remove the per-instance profile dir. Swallow errors
 * (the worst case is a few MB of orphaned files in /tmp that the OS will
 * eventually clean up).
 */
async function removeProfileDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[libreoffice] profile cleanup failed for ${dir}:`, err);
  }
}

function runConvert(
  binary: string,
  inputPath: string,
  outputDir: string,
  profileDir: string,
  timeoutMs: number,
): Promise<void> {
  // LibreOffice expects a file:// URL for -env:UserInstallation. Using
  // pathToFileURL ensures correct encoding (spaces, unicode, etc.).
  const profileUrl = pathToFileURL(profileDir).toString();
  return new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      [
        `-env:UserInstallation=${profileUrl}`,
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        outputDir,
        inputPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stderrTail = "";
    let stdoutTail = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`[libreoffice] timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutTail = (stdoutTail + chunk.toString("utf8")).slice(-2048);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2048);
      // eslint-disable-next-line no-console
      console.error(`[libreoffice] ${chunk.toString("utf8").trimEnd()}`);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `[libreoffice] ${binary} exited with code ${code}. stderr=${stderrTail} stdout=${stdoutTail}`,
          ),
        );
    });
  });
}

export interface ConvertDocxInput {
  inputPath: string;
  outputDir: string;
  timeoutMs?: number;
}

/**
 * Convert a DOCX file to PDF. Returns the absolute path of the produced
 * PDF on success. Retries once with `soffice` if the primary binary fails.
 *
 * Each invocation gets its own ephemeral user-profile directory so multiple
 * conversions can run in parallel without fighting over the profile lock.
 */
export async function convertDocxToPdf(
  input: ConvertDocxInput,
): Promise<string> {
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const expected = join(
    input.outputDir,
    `${basename(input.inputPath, extname(input.inputPath))}.pdf`,
  );

  const profileDir = await createProfileDir();
  try {
    try {
      await runConvert(
        defaultBinary(),
        input.inputPath,
        input.outputDir,
        profileDir,
        timeout,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[libreoffice] primary conversion failed, retrying with soffice:`,
        err,
      );
      // Some Debian/Ubuntu builds ship `soffice` only. The retry reuses the
      // same profile dir — if the first attempt left it in a weird state we
      // would rather see the error than mask it with a second fresh profile.
      await runConvert(
        "/usr/bin/soffice",
        input.inputPath,
        input.outputDir,
        profileDir,
        timeout,
      );
    }

    // Verify the output exists.
    await stat(expected);
    return expected;
  } finally {
    await removeProfileDir(profileDir);
  }
}
