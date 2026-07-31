import { DemoPlayer } from "./DemoPlayer";
import { RevealOnScroll } from "./RevealOnScroll";

export function DemoSection() {
  return (
    <section
      id="demo"
      className="relative z-[1] w-full bg-[#f7f5fd] text-ink overflow-hidden py-20 md:py-40"
    >
      {/* Softe Sky-Glows: Lavendel zentral, Rosé unten — freundliche,
          helle Himmel-Atmosphäre statt dunklem Void. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, #f7f5fd 0%, rgba(247,245,253,0) 28%), radial-gradient(110% 80% at 50% 45%, rgba(170,140,245,0.14) 0%, rgba(170,140,245,0.05) 38%, rgba(170,140,245,0) 100%), radial-gradient(80% 50% at 50% 100%, rgba(244,178,214,0.18) 0%, rgba(244,178,214,0) 70%)",
        }}
      />

      <div className="relative max-w-5xl mx-auto px-6 md:px-10">
        <div className="text-center max-w-3xl mx-auto mb-14 md:mb-20">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-white border border-brand-200 text-brand-deep text-[11px] font-semibold tracking-[0.18em] uppercase mb-7 shadow-[0_2px_12px_-4px_rgba(124,92,232,0.25)]">
              Live-Demo
            </div>
          </RevealOnScroll>

          <RevealOnScroll delay={200}>
            <h2 className="font-light tracking-[-0.04em] leading-[1.05] text-ink text-[clamp(34px,4.6vw,60px)] text-balance">
              Wie sieht ein
            </h2>
          </RevealOnScroll>

          <RevealOnScroll delay={380}>
            <h2
              className="font-light tracking-[-0.04em] leading-[1.05] bg-clip-text text-transparent text-[clamp(34px,4.6vw,60px)] text-balance"
              style={{
                backgroundImage:
                  "linear-gradient(96deg, #9573EE 0%, #7C5CE8 45%, #5E44C2 75%, #3F2D8A 100%)",
              }}
            >
              personalisiertes Video
            </h2>
          </RevealOnScroll>

          <RevealOnScroll delay={540}>
            <h2 className="font-light tracking-[-0.04em] leading-[1.05] text-ink text-[clamp(34px,4.6vw,60px)] text-balance">
              eigentlich aus?
            </h2>
          </RevealOnScroll>

          <RevealOnScroll delay={820}>
            <p className="mt-9 text-lg md:text-xl leading-relaxed text-ink-soft text-balance max-w-xl mx-auto">
              Du hast{" "}
              <strong className="font-semibold text-ink">
                volle Freiheit
              </strong>
              , wie dein Video am Ende aussieht. Wie eine persönliche
              Loom-Aufnahme: persönlich, authentisch und auffallend für
              deinen zukünftigen Kunden.
            </p>
          </RevealOnScroll>
        </div>

        <RevealOnScroll delay={1020}>
          <DemoPlayer />
        </RevealOnScroll>
      </div>
    </section>
  );
}
