import { DemoPlayer } from "./DemoPlayer";
import { RevealOnScroll } from "./RevealOnScroll";

export function DemoSection() {
  return (
    <section
      id="demo"
      className="relative z-[1] w-full bg-black text-white overflow-hidden py-20 md:py-40"
    >
      {/* Sehr softer, vollflächiger Brand-Purple-Glow — keine harten
          Übergänge mehr: zentriert, gross, mit weichem Falloff bis 100 %. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(110% 80% at 50% 50%, rgba(170,140,245,0.16) 0%, rgba(170,140,245,0.06) 38%, rgba(170,140,245,0) 100%)",
        }}
      />

      <div className="relative max-w-5xl mx-auto px-6 md:px-10">
        <div className="text-center max-w-3xl mx-auto mb-14 md:mb-20">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-white/8 border border-white/15 backdrop-blur text-white/85 text-[11px] font-semibold tracking-[0.18em] uppercase mb-7">
              Live-Demo
            </div>
          </RevealOnScroll>

          <RevealOnScroll delay={200}>
            <h2 className="font-light tracking-[-0.04em] leading-[1.05] text-white text-[clamp(34px,4.6vw,60px)] text-balance">
              Wie sieht ein
            </h2>
          </RevealOnScroll>

          <RevealOnScroll delay={380}>
            <h2
              className="font-light tracking-[-0.04em] leading-[1.05] bg-clip-text text-transparent text-[clamp(34px,4.6vw,60px)] text-balance"
              style={{
                backgroundImage:
                  "linear-gradient(96deg, #C7B6FE 0%, #AA8CF5 35%, #7C5CE8 70%, #5232C7 100%)",
              }}
            >
              personalisiertes Video
            </h2>
          </RevealOnScroll>

          <RevealOnScroll delay={540}>
            <h2 className="font-light tracking-[-0.04em] leading-[1.05] text-white text-[clamp(34px,4.6vw,60px)] text-balance">
              eigentlich aus?
            </h2>
          </RevealOnScroll>

          <RevealOnScroll delay={820}>
            <p className="mt-9 text-lg md:text-xl leading-relaxed text-white/65 text-balance max-w-xl mx-auto">
              Du hast{" "}
              <strong className="font-semibold text-white">
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
