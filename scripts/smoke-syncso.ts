/**
 * Smoke-Test: kommt Node-fetch an der Cloudflare-Bot-Protection von
 * sync.so vorbei? (python-urllib bekam 403 error 1010, curl ging durch.)
 *
 * Ruft getGeneration auf einen existierenden COMPLETED-Job auf — erst mit
 * purem Node-fetch (ohne Client-Fallback), dann über den Client (der bei
 * 403 automatisch auf curl zurückfällt).
 *
 * Usage: npx tsx scripts/smoke-syncso.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { getGeneration } from "../src/lib/syncso";

const KNOWN_COMPLETED_ID = "ebb68486-5055-4ff9-8b33-fe836146d132";

async function rawFetchProbe(): Promise<void> {
  const res = await fetch(
    `https://api.sync.so/v2/generate/${KNOWN_COMPLETED_ID}`,
    {
      headers: {
        "x-api-key": process.env.SYNCSO_API_KEY ?? "",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    },
  );
  const text = await res.text();
  console.log(`[smoke] raw Node fetch: HTTP ${res.status}`);
  if (!res.ok) {
    console.log(`[smoke] body head: ${text.slice(0, 200)}`);
    throw new Error("raw fetch blocked");
  }
  const json = JSON.parse(text) as { id: string; status: string };
  console.log(`[smoke] raw fetch OK: id=${json.id} status=${json.status}`);
}

async function main(): Promise<void> {
  if (!process.env.SYNCSO_API_KEY) {
    throw new Error("SYNCSO_API_KEY missing (load .env.local)");
  }
  let fetchWorks = true;
  try {
    await rawFetchProbe();
  } catch {
    fetchWorks = false;
  }

  const gen = await getGeneration(KNOWN_COMPLETED_ID);
  console.log(
    `[smoke] client getGeneration: id=${gen.id} status=${gen.status} outputUrl=${gen.outputUrl ? "yes" : "no"}`,
  );
  console.log(
    fetchWorks
      ? "[smoke] RESULT: Node fetch passes Cloudflare — no curl fallback needed."
      : "[smoke] RESULT: Node fetch BLOCKED — client curl fallback required.",
  );
}

main().catch((err) => {
  console.error("[smoke] failed:", err);
  process.exit(1);
});
