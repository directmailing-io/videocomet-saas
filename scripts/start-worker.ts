/**
 * Production worker entrypoint.
 *
 * Invoked via the npm scripts `worker:dev` (tsx watch) and `worker:start`
 * (compiled node). All real wiring lives in `src/worker/index.ts` — außer
 * mit WORKER_ROLE=render: dann bootet der schlanke Render-only-Entry
 * (`src/worker/render-only.ts`) für zusätzliche Render-Server ohne
 * Singleton-Wartungsjobs.
 */

const entry =
  process.env.WORKER_ROLE === "render"
    ? "../src/worker/render-only"
    : "../src/worker/index";

import(entry).catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[start-worker] fatal:", err);
  process.exit(1);
});
