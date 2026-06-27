/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Consume the shared workspace package directly from source.
  transpilePackages: ["@vbd/shared"],
  // NOTE: For the Electron build (P4) we'll enable `output: "standalone"`.
  // It's omitted here because its file-tracing step needs symlink permission
  // on Windows (Developer Mode / admin), which we'll arrange during packaging.
};

export default nextConfig;
