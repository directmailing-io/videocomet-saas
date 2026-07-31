import { Inter, JetBrains_Mono } from "next/font/google";

// Self-hosted via next/font: Fonts werden beim Build gebundelt, kein
// Request an Google-Server zur Laufzeit (DSGVO, vgl. LG Muenchen I 3 O 17493/20).
export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-inter",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

export const fontClasses = `${inter.variable} ${jetbrainsMono.variable}`;
