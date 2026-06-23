import { DemoSection } from "@/components/marketing/DemoSection";
import { FeaturesBento } from "@/components/marketing/FeaturesBento";
import { HeroScrollVideo } from "@/components/marketing/HeroScrollVideo";
import { HowItWorksSection } from "@/components/marketing/HowItWorksSection";
import { MarketingNav } from "@/components/marketing/MarketingNav";
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

      <footer
        id="page-footer"
        className="w-full px-6 py-5 border-t border-line bg-surface"
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-ink-muted">
          <span>© {new Date().getFullYear()} VIDEOCOMET</span>
          <span>Made in Germany</span>
        </div>
      </footer>
    </div>
  );
}
