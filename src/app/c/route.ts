/**
 * Same-Origin Tracking-Endpoint mit absichtlich neutralem Pfad.
 *
 * Hintergrund:
 *   - Custom-LPs laufen auf eigenen Hosts (lp.videocomet.de oder einer
 *     Kunden-Custom-Domain). Vorher zeigte die Bridge auf den absolute
 *     URL `https://app.videocomet.de/api/track/event` — cross-origin,
 *     plus offensichtlicher Pfad „track/event" den AdBlocker-Filter-
 *     Listen pauschal blocken.
 *   - Jetzt: die Bridge POSTet zu `/c` (relativ). Same-origin → kein
 *     CORS, kein Preflight, und der Pfad sieht aus wie irgendein
 *     statisches Asset, nicht wie ein Tracking-Endpoint.
 *
 * Dieses File ist nur ein Alias auf `/api/track/event`. Wir re-exportieren
 * den existierenden Handler so dass es nur EINE Implementation gibt.
 */

export { POST, OPTIONS, dynamic, runtime } from "../api/track/event/route";
