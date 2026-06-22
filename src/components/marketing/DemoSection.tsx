import { DemoPlayer } from "./DemoPlayer";
import { RevealOnScroll } from "./RevealOnScroll";

export function DemoSection() {
  return (
    <section
      id="demo"
      className="relative z-[1] w-full bg-black text-white overflow-hidden py-32 md:py-40"
    >
      {/* Sehr dezenter radialer Brand-Glow oben in der Mitte fuer
          Tiefe und Marken-Akzent — bleibt subtil schwarz */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(124,92,232,0.18) 0%, rgba(124,92,232,0) 60%)",
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
            <h2 className="font-light tracking-[-0.04em] leading-[1.05] text-white text-[clamp(40px,5.6vw,80px)] text-balance">
              Wie sieht ein
            </h2>
          </RevealOnScroll>

          <RevealOnScroll delay={380}>
            <h2
              className="font-light tracking-[-0.04em] leading-[1.05] bg-clip-text text-transparent text-[clamp(40px,5.6vw,80px)] text-balance"
              style={{
                backgroundImage:
                  "linear-gradient(96deg, #C7B6FE 0%, #AA8CF5 35%, #7C5CE8 70%, #5232C7 100%)",
              }}
            >
              personalisiertes Video
            </h2>
          </RevealOnScroll>

          <RevealOnScroll delay={540}>
            <h2 className="font-light tracking-[-0.04em] leading-[1.05] text-white text-[clamp(40px,5.6vw,80px)] text-balance">
              eigentlich aus?
            </h2>
          </RevealOnScroll>

          <RevealOnScroll delay={820}>
            <p className="mt-9 text-lg md:text-xl leading-relaxed text-white/65 text-balance max-w-2xl mx-auto">
              Du hast volle Freiheit, wie dein Video am Ende aussieht. Wie
              eine persönliche Loom-Aufnahme: deine Webcam plus alles, was
              du auf dem Bildschirm zeigen willst. Wähle Modus und
              Empfänger und sieh, wie sich das Video live anpasst.
            </p>
          </RevealOnScroll>
        </div>

        <RevealOnScroll delay={1020}>
          <DemoPlayer />
        </RevealOnScroll>

        <RevealOnScroll delay={1240}>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 mt-14 text-xs text-white/55">
            <span className="inline-flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-brand-light" />
              30 Sekunden Webcam, 1000 personalisierte Videos
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-brand-light" />
              Vollautomatisch generiert
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-brand-light" />
              Eigene Landingpage für jeden Empfänger
            </span>
          </div>
        </RevealOnScroll>
      </div>
    </section>
  );
}
