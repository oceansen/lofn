import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "pg", "sharp", "file-type"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          // Only Lofn itself and the Hugging Face Space page may embed the app.
          { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://huggingface.co" },
          // Camera + microphone are needed for in-browser recording on our own origin only.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
