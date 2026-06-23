import { DemoSection } from "@/components/marketing/DemoSection";
import { FAQSection } from "@/components/marketing/FAQSection";
import { FeaturesBento } from "@/components/marketing/FeaturesBento";
import { HeroScrollVideo } from "@/components/marketing/HeroScrollVideo";
import { HowItWorksSection } from "@/components/marketing/HowItWorksSection";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { PricingSection } from "@/components/marketing/PricingSection";
import { WhyItWorksSection } from "@/components/marketing/WhyItWorksSection";

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <MarketingNav />
      <HeroScrollVideo />
      <DemoSection />
      <HowItWorksSection />
      <FeaturesBento />
      <WhyItWorksSection />
      <PricingSection />
      <FAQSection />
      <MarketingFooter />
    </div>
  );
}
