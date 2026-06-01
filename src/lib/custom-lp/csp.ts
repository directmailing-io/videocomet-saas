/**
 * Content-Security-Policy builder for the Custom-LP sandbox renderer.
 *
 * Tradeoffs (per project policy decision):
 *  - Customer-provided HTML/CSS/JS is EXPLICITLY ALLOWED to do almost
 *    anything (inline scripts, eval, external CDN fetches over https).
 *    This is a deliberate "loose-sandbox" choice: customers want to
 *    paste in Webflow / Framer / Wix-export HTML and have it work,
 *    and the security model we accept here is "your own users only ever
 *    visit YOUR landing pages, and you the customer signed a TOS".
 *  - We still keep three hard rails that defend against attacks the
 *    customer themselves could not opt out of even if they wanted to:
 *      * frame-ancestors 'none'  → prevent clickjacking embeds
 *      * base-uri 'self'         → block <base href="…attacker"> hijacks
 *      * form-action 'self' app  → block stealth POSTs to attacker hosts
 *  - `connect-src` is restricted to the page's own origin + the app
 *    domain so that the tracking-bridge can POST to
 *    `https://app.videocomet.de/api/track/event` while custom JS still
 *    can't beacon to arbitrary attacker origins. (The user can ALWAYS
 *    open their own outbound channel via <img> or <script src=…>, but
 *    that's the loose part of the contract.)
 *
 * Header is built fresh on every request — there's no caller-supplied
 * config and the cost is microseconds, so memoisation isn't worth the
 * complexity.
 */
export function buildCustomLpCspHeader(): string {
  // Source-list directives are joined with "; " per CSP spec.
  return [
    "default-src 'self' https: data: blob:",
    // Inline + eval explicitly allowed — see file-level note.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
    "style-src 'self' 'unsafe-inline' https:",
    "font-src 'self' https: data:",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https: blob:",
    // Tracking endpoint lives on the main app domain; same-origin is the
    // sandbox itself. No wildcard so customer JS can't quietly beacon
    // to attacker hosts.
    "connect-src 'self' https://app.videocomet.de",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://app.videocomet.de",
  ].join("; ");
}
