import Link from "next/link";
import { RevealOnScroll } from "./RevealOnScroll";
import { Squircle } from "./Squircle";

export function FinalCtaSection() {
  return (
    <section className="relative z-[2] w-full bg-white py-16 md:py-28">
      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <RevealOnScroll delay={0}>
          <Squircle radius={32} shadow="pretty" className="relative overflow-hidden">
            <div
              className="absolute inset-0 bg-cover"
              style={{
                backgroundImage: "url(/visual-sky.jpg)",
                backgroundPosition: "50% 40%",
              }}
              aria-hidden
            />
            <div className="relative flex flex-col items-center text-center px-6 py-16 md:py-24">
              <Squircle
                radius={20}
                shadow="float"
                className="bg-white/95 backdrop-blur-md px-8 py-8 md:px-12 md:py-10 max-w-xl"
              >
                <h2 className="font-light tracking-[-0.035em] text-ink leading-[1.08] text-[clamp(28px,3.6vw,44px)] text-balance">
                  Bereit, bei deinen Leads
                  <br />
                  <span className="font-semibold text-brand-deep">
                    im Kopf zu bleiben?
                  </span>
                </h2>
                <p className="mt-4 text-[15px] leading-relaxed text-ink-soft text-balance">
                  Nimm ein Video auf, den Rest übernimmt VIDEOCOMET. 40 € im
                  Monat, 1 € pro Lead, alles inklusive.
                </p>
                <div className="mt-6 flex justify-center">
                  <Link
                    href="/signup"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-ink text-white text-sm font-semibold hover:bg-ink/90 transition-colors shadow-ink"
                  >
                    Jetzt direkt loslegen
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
                <p className="mt-4 text-[13px] font-medium text-ink-soft">
                  Kein Beratungsgespräch nötig. Du kannst direkt loslegen.
                </p>
                <p className="mt-3 text-[12px] text-ink-muted">
                  3 Monate Mindestlaufzeit · nur für Unternehmen (B2B) · Kunden
                  seit 2022
                </p>
              </Squircle>
            </div>
          </Squircle>
        </RevealOnScroll>
      </div>
    </section>
  );
}
