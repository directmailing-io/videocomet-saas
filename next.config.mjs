/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // archiver ships an `exports` map whose "default" entry is not the last
  // condition, which trips webpack's exports-validator. Marking the package
  // as external lets node resolve it natively at runtime in the
  // server-component / route-handler runtime.
  experimental: {
    serverComponentsExternalPackages: ["archiver", "xlsx"],
  },
};

export default nextConfig;
