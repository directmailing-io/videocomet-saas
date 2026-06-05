/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // archiver ships an `exports` map whose "default" entry is not the last
  // condition, which trips webpack's exports-validator. Marking the package
  // as external lets node resolve it natively at runtime in the
  // server-component / route-handler runtime.
  experimental: {
    serverComponentsExternalPackages: ["archiver", "xlsx", "pdf-lib"],
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
