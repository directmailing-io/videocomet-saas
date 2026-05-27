/**
 * Production worker entrypoint.
 *
 * Invoked via the npm scripts `worker:dev` (tsx watch) and `worker:start`
 * (compiled node). All real wiring lives in `src/worker/index.ts`.
 */

import "../src/worker/index";
