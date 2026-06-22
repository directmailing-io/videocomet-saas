import { DemoSection } from "@/components/marketing/DemoSection";
import { HeroScrollVideo } from "@/components/marketing/HeroScrollVideo";
import { MarketingNav } from "@/components/marketing/MarketingNav";

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <MarketingNav />
      <HeroScrollVideo />
      <DemoSection />

      <footer className="w-full px-6 py-5 border-t border-line bg-surface">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-ink-muted">
          <span>© {new Date().getFullYear()} VIDEOCOMET</span>
          <span>Made in Germany</span>
        </div>
      </footer>
    </div>
  );
}
