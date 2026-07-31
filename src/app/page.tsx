import { DemoSection } from "@/components/marketing/DemoSection";
import { FAQSection } from "@/components/marketing/FAQSection";
import { FeaturesBento } from "@/components/marketing/FeaturesBento";
import { HeroSection } from "@/components/marketing/HeroSection";
import { HowItWorksSection } from "@/components/marketing/HowItWorksSection";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { PricingSection } from "@/components/marketing/PricingSection";

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <MarketingNav />
      <HeroSection />
      <DemoSection />
      <HowItWorksSection />
      <FeaturesBento />
      <PricingSection />
      <FAQSection />
      <MarketingFooter />
    </div>
  );
}
