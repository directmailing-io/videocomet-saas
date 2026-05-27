/**
 * LibreOffice headless DOCX-to-PDF wrapper.
 *
 * Spawns `libreoffice --headless --convert-to pdf --outdir <dir> <input>`.
 * The output filename is the input basename with the extension replaced.
 *
 * LibreOffice occasionally crashes under load. We retry once with the
 * `soffice` alias which sometimes routes through a slightly different
 * profile-init path.
 */

import { spawn } from "node:child_process";
import { basename, extname, join } from "node:path";
import { stat } from "node:fs/promises";

const DEFAULT_TIMEOUT_MS = 90_000;

function defaultBinary(): string {
  return process.env.LIBREOFFICE_PATH ?? "/usr/bin/libreoffice";
}

function runConvert(
  binary: string,
  inputPath: string,
  outputDir: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      ["--headless", "--convert-to", "pdf", "--outdir", outputDir, inputPath],
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
 */
export async function convertDocxToPdf(
  input: ConvertDocxInput,
): Promise<string> {
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const expected = join(
    input.outputDir,
    `${basename(input.inputPath, extname(input.inputPath))}.pdf`,
  );

  try {
    await runConvert(defaultBinary(), input.inputPath, input.outputDir, timeout);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[libreoffice] primary conversion failed, retrying with soffice:`,
      err,
    );
    // Some Debian/Ubuntu builds ship `soffice` only.
    await runConvert("/usr/bin/soffice", input.inputPath, input.outputDir, timeout);
  }

  // Verify the output exists.
  await stat(expected);
  return expected;
}
