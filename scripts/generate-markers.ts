/**
 * CLI entry point: regenerates the placeholder marker PNGs in /public.
 *
 * Run via: `npm run markers:generate`
 */

import { writeMarkersToPublic } from "../src/lib/marker-placeholders";

async function main(): Promise<void> {
  const result = await writeMarkersToPublic();
  // eslint-disable-next-line no-console
  console.log("[markers] wrote:");
  // eslint-disable-next-line no-console
  console.log(`  ${result.qrPath}    sha256=${result.qrSha256}`);
  // eslint-disable-next-line no-console
  console.log(`  ${result.thumbPath} sha256=${result.thumbSha256}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[markers] failed:", err);
  process.exit(1);
});
