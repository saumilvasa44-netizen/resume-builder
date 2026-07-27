/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pdfkit and mammoth ship non-JS assets (font files, etc.) that Next's
    // default webpack config for server code doesn't need to touch —
    // external keeps them as real filesystem requires instead of being
    // bundled/mangled. IMPORTANT: this app runs on Next 14.2.35, where this
    // option only exists under `experimental` (it wasn't promoted to a
    // top-level `serverExternalPackages` key until Next 15) — it was
    // previously set at the top level here, which Next 14 silently ignores,
    // so pdfkit was actually getting webpack-bundled instead of externalized.
    serverComponentsExternalPackages: ["pdfkit", "mammoth"],
    // Even externalized, Vercel's deployment file-tracer (@vercel/nft)
    // doesn't reliably detect pdfkit's *.afm standard-font metric files,
    // since pdfkit loads them at runtime via a dynamic
    // `fs.readFileSync(path.join(__dirname, "data", ...))` call rather than
    // a static import it can trace — without this, the files silently don't
    // get included in the deployed function, and pdfkit fails at runtime
    // with "ENOENT ... Helvetica.afm" the moment a PDF is generated (only
    // on Vercel; a local `next build && next start` won't reproduce this).
    // Explicitly telling the tracer to include them for every route that can
    // call generatePdf() (lib/pdfGenerator.ts) fixes it.
    outputFileTracingIncludes: {
      "/api/render-files": ["./node_modules/pdfkit/js/data/**"],
      "/api/chat": ["./node_modules/pdfkit/js/data/**"],
      "/api/generate": ["./node_modules/pdfkit/js/data/**"],
    },
  },
};
export default nextConfig;
