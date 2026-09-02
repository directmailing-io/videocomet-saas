/**
 * Content-Security-Policy im REPORT-ONLY-Modus (Security-Härtung 2026-09-02).
 * Blockiert nichts, meldet Verstöße an /api/csp-report. Nach einer Woche
 * ohne echte Treffer im Container-Log wird der Header auf
 * "Content-Security-Policy" (enforce) umgestellt. Liste der bekannten
 * Drittquellen: Turnstile (challenges.cloudflare.com), Meta Pixel
 * (connect.facebook.net, www.facebook.com), Bunny-Player
 * (iframe.mediadelivery.net, *.b-cdn.net), Google Fonts, Google Docs/Slides-
 * Embeds, Stripe-Redirects (form-action).
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' blob: data: https://*.b-cdn.net https://*.mediadelivery.net",
  "connect-src 'self' https://*.b-cdn.net https://*.mediadelivery.net https://challenges.cloudflare.com https://www.facebook.com https://connect.facebook.net https://storage.bunnycdn.com https://*.storage.bunnycdn.com",
  "frame-src 'self' https://challenges.cloudflare.com https://iframe.mediadelivery.net https://docs.google.com https://drive.google.com https://www.youtube.com https://player.vimeo.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
  "frame-ancestors 'self'",
  "report-uri /api/csp-report",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // SECURITY: `X-Powered-By: Next.js`-Leak unterdruecken.
  poweredByHeader: false,
  async headers() {
    // Globale Security-Header auf jeder Response. Pfad-spezifische
    // Ausnahmen: `/lp-block/*` setzt eigene CSP-Header via csp.ts.
    return [
      {
        source: "/:path*",
        headers: [
          // HSTS: 1 Jahr + Sub-Domains + preload-eligible. Browser
          // ignorieren bei HTTP — also safe als Default.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          // MIME-Sniffing off.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Frame-Embedding nur same-origin (lp-block setzt das selbst).
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Cross-Domain Referrer minimieren.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Hardware-Permissions: Kamera+Mic nur self (Webcam-Aufnahme),
          // Rest komplett blocken.
          {
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
          },
        ],
      },
      {
        // Erst nur melden, dann scharf schalten (siehe CSP_REPORT_ONLY oben).
        // Kunden-Landingpages (/v, /cv, /lp-block, /c, /domain-root) sind
        // ausgenommen: sie haben eine eigene, bewusst lockere CSP (csp.ts)
        // und wuerden das Report-Log nur mit Kunden-HTML-Treffern fluten.
        source: "/((?!v/|cv/|lp-block/|c$|domain-root).*)",
        headers: [
          { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
        ],
      },
    ];
  },
  // archiver ships an `exports` map whose "default" entry is not the last
  // condition, which trips webpack's exports-validator. Marking the package
  // as external lets node resolve it natively at runtime in the
  // server-component / route-handler runtime.
  experimental: {
    serverComponentsExternalPackages: ["archiver", "xlsx", "pdf-lib"],
    // Standalone-Build via `output: "standalone"` traced den archiver-
    // require nicht weil wir ihn ueber `eval('require')` lazy-laden
    // (Webpack mangled sowohl statischen import als auch createRequire
    // zu nicht-callable Code). Explizite Trace-Inclusion sichert dass
    // archiver + Transitives in den standalone-Bundle kopiert wird.
    outputFileTracingIncludes: {
      "/api/runs/bulk-export": [
        "./node_modules/archiver/**/*",
        "./node_modules/archiver-utils/**/*",
        "./node_modules/zip-stream/**/*",
        "./node_modules/compress-commons/**/*",
        "./node_modules/crc-32/**/*",
        "./node_modules/crc32-stream/**/*",
        "./node_modules/buffer-crc32/**/*",
        "./node_modules/normalize-path/**/*",
        "./node_modules/readdir-glob/**/*",
        "./node_modules/lazystream/**/*",
        "./node_modules/lodash/**/*",
        "./node_modules/glob/**/*",
        "./node_modules/minimatch/**/*",
      ],
    },
  },
  // ESLint im Container-Build NICHT aktivieren — die .eslintrc.json wird
  // lokal + via `npm run lint` gepflegt. Im Docker-Build laeuft `npm ci`
  // ohne devDependencies, weshalb @typescript-eslint-Plugin-Disable-
  // Direktiven im Source als "rule unknown" failen. Build-Sicherheit
  // statt Linting im Container.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
