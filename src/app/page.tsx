import type { Metadata } from "next";
import { ComingSoonIntro } from "@/components/marketing/ComingSoonIntro";
import { DemoSection } from "@/components/marketing/DemoSection";
import { FAQSection } from "@/components/marketing/FAQSection";
import { FAQ } from "@/components/marketing/faq-data";
import { FeaturesBento } from "@/components/marketing/FeaturesBento";
import { FinalCtaSection } from "@/components/marketing/FinalCtaSection";
import { HeroSection } from "@/components/marketing/HeroSection";
import { HowItWorksSection } from "@/components/marketing/HowItWorksSection";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { PricingSection } from "@/components/marketing/PricingSection";
import { TestimonialsSection } from "@/components/marketing/TestimonialsSection";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://videocomet.de/#organization",
      name: "VIDEOCOMET GmbH",
      url: "https://videocomet.de",
      logo: "https://videocomet.de/logo.svg",
      email: "info@videocomet.de",
      address: {
        "@type": "PostalAddress",
        streetAddress: "Herrleinstr. 39",
        postalCode: "97437",
        addressLocality: "Haßfurt",
        addressCountry: "DE",
      },
    },
    {
      "@type": "SoftwareApplication",
      name: "VIDEOCOMET",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://videocomet.de",
      description:
        "SaaS für persönliche Outreach-Videos: Landingpages, Briefe mit QR-Code, Live-Tracking und CRM-Anbindungen.",
      offers: {
        "@type": "Offer",
        price: "40.00",
        priceCurrency: "EUR",
        description:
          "Plattform-Zugang 40 € netto pro Monat, abgerechnet als 120 € pro 3 Monate. Videos zusätzlich 1 € pro Stück.",
      },
      provider: { "@id": "https://videocomet.de/#organization" },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ],
};

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MarketingNav />
      <HeroSection />
      <ComingSoonIntro />
      <DemoSection />
      <HowItWorksSection />
      <TestimonialsSection />
      <FeaturesBento />
      <PricingSection />
      <FAQSection />
      <FinalCtaSection />
      <MarketingFooter />
    </div>
  );
}
