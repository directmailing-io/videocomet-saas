import type { Metadata } from "next";
import { CookieBanner } from "@/components/consent/CookieBanner";
import { MetaPixelLoader } from "@/components/meta/meta-pixel-loader";
import { fontClasses } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://videocomet.de"),
  title: {
    default: "VIDEOCOMET · Persönliche Videos, die Kunden gewinnen",
    template: "%s · VIDEOCOMET",
  },
  description:
    "Mit VIDEOCOMET verschickst du hunderte persönliche Videos an potenzielle Kunden. Mit Landingpage, Brief mit QR-Code und Live-Tracking. 120 € für 3 Monate, 1 € pro Video.",
  applicationName: "VIDEOCOMET",
  openGraph: {
    type: "website",
    locale: "de_DE",
    siteName: "VIDEOCOMET",
    url: "https://videocomet.de",
    title: "VIDEOCOMET · Persönliche Videos, die Kunden gewinnen",
    description:
      "Hunderte persönliche Videos an potenzielle Kunden. Mit Landingpage, Brief mit QR-Code und Live-Tracking.",
  },
  twitter: {
    card: "summary_large_image",
    title: "VIDEOCOMET · Persönliche Videos, die Kunden gewinnen",
    description:
      "Hunderte persönliche Videos an potenzielle Kunden. Mit Landingpage, Brief mit QR-Code und Live-Tracking.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";
  return (
    <html lang="de" className={fontClasses}>
      <body>
        {children}
        <CookieBanner />
        {pixelId ? <MetaPixelLoader pixelId={pixelId} /> : null}
      </body>
    </html>
  );
}
