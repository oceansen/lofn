import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Lofn", template: "%s · Lofn" },
  description: "Lofn turns a group's text, voice, photos and video into one evolving, shared answer.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#eef1ef" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
