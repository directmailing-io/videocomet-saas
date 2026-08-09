"use client";

import * as React from "react";
import { RevealOnScroll } from "./RevealOnScroll";
import { Squircle } from "./Squircle";

/**
 * Zeigt zwischen Kundenstimmen und Feature-Bento den persönlichen Draht
 * zu unseren Kunden: Fotos vom VIDEOCOMET-Day in Würzburg + kurzer Text
 * mit den bisherigen Speakern als Inline-Chips.
 */

const SPEAKERS: ReadonlyArray<{ name: string; company: string }> = [
  { name: "Bastian Schmidt", company: "Umsetzer.de" },
  { name: "Nino Tschöpe", company: "Leadmagnet.de" },
  { name: "Vincent Dehn", company: "VIDEOSTATEMENTS" },
];

const PHOTOS: ReadonlyArray<{ src: string; alt: string }> = [
  {
    src: "/community/vc-day-buehne.jpg",
    alt: "Speaker vor Publikum beim VIDEOCOMET-Day in Würzburg",
  },
  {
    src: "/community/vc-day-speaker.jpg",
    alt: "Speaker mit Headset präsentiert",
  },
  {
    src: "/community/vc-day-notizen.jpg",
    alt: "Teilnehmer macht Notizen während des Vortrags",
  },
  {
    src: "/community/vc-day-lanyards.jpg",
    alt: "VIDEOCOMET-Lanyards der Teilnehmer",
  },
];

export function CommunitySection() {
  return (
    <section
      id="community"
      className="relative z-[2] w-full bg-white pb-16 md:pb-32"
    >
      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <RevealOnScroll delay={0}>
          <Squircle
            radius={28}
            shadow="pretty"
            className="bg-[#f8f7fd] p-5 md:p-8"
          >
            <div className="grid gap-6 md:grid-cols-2 md:gap-10 items-center">
              <div className="grid grid-cols-2 gap-3">
                {PHOTOS.map((p) => (
                  <Squircle
                    key={p.src}
                    radius={18}
                    wrapperClassName="w-full aspect-square"
                    className="relative size-full bg-ink"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.src}
                      alt={p.alt}
                      className="absolute inset-0 size-full object-cover"
                      loading="lazy"
                    />
                  </Squircle>
                ))}
              </div>

              <div>
                <h3 className="font-semibold tracking-[-0.02em] text-ink leading-[1.15] text-[clamp(22px,2.4vw,30px)] mb-4 text-balance">
                  Enger Draht zu unseren Kunden.
                </h3>
                <p className="text-ink-muted text-[16.5px] leading-relaxed">
                  Wir treffen unsere Kunden auch persönlich, zuletzt beim
                  VIDEOCOMET-Day in Würzburg. Ein Tag zum Austauschen und für
                  Einblicke von Speakern wie{" "}
                  {SPEAKERS.map((s, i) => (
                    <React.Fragment key={s.name}>
                      <span className="inline-flex items-baseline gap-1 rounded-full bg-white px-2.5 py-0.5 text-[13.5px] text-ink whitespace-nowrap align-baseline shadow-sm">
                        <span className="font-semibold">{s.name}</span>
                        <span className="text-ink-muted">· {s.company}</span>
                      </span>
                      {i < SPEAKERS.length - 2
                        ? ", "
                        : i === SPEAKERS.length - 2
                          ? " oder "
                          : "."}
                    </React.Fragment>
                  ))}
                </p>
              </div>
            </div>
          </Squircle>
        </RevealOnScroll>
      </div>
    </section>
  );
}
