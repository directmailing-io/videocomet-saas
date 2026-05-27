import type { Metadata } from "next";
import "../../globals.css";

export const metadata: Metadata = {
  title: "VIDEOCOMET",
  description: "Personalisierte Videobotschaft.",
  robots: { index: false, follow: false },
};

/**
 * Minimal standalone layout for public landing-pages.
 *
 * Intentionally bypasses the AppShell / AdminShell — these are tenant
 * dashboards and should never appear on the public-facing page that lead
 * recipients see. We only mount fonts and the global stylesheet.
 */
export default function PublicLandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <meta name="referrer" content="no-referrer-when-downgrade" />
      </head>
      <body>{children}</body>
    </html>
  );
}
