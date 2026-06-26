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
