"use client";

import * as React from "react";
import { MapPin } from "lucide-react";
import { RevealOnScroll } from "./RevealOnScroll";
import { Squircle } from "./Squircle";

/**
 * Community-Sektion: zeigt, dass hinter VIDEOCOMET nicht nur Software
 * steht, sondern ein echtes Kundennetzwerk (VIDEOCOMET-Day in Würzburg,
 * Speaker-Line-up, gemeinsamer Austausch).
 */

const SPEAKERS: ReadonlyArray<{ name: string; company: string }> = [
  { name: "Bastian Schmidt", company: "Umsetzer.de" },
  { name: "Nino Tschöpe", company: "Leadmagnet.de" },
  { name: "Vincent Dehn", company: "VIDEOSTATEMENTS" },
];

export function CommunitySection() {
  return (
    <section
      id="community"
      className="relative z-[2] w-full bg-white pb-16 md:pb-32"
    >
      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <div className="max-w-2xl mx-auto text-center mb-10 md:mb-14">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold tracking-[0.18em] uppercase mb-6">
              Community
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={100}>
            <h2 className="font-light tracking-[-0.035em] text-ink leading-[1.05] text-[clamp(28px,3.8vw,48px)] mb-5 text-balance">
              Kein anonymes Tool.
              <br />
              <span className="font-semibold text-brand-deep">
                Ein Netzwerk, das zusammenkommt.
              </span>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={200}>
            <p className="text-ink-muted text-lg leading-relaxed text-balance max-w-xl mx-auto">
              Einmal im Jahr treffen sich unsere Kunden persönlich beim
              VIDEOCOMET-Day in Würzburg. Austausch mit anderen Unternehmern,
              Insights von starken Speakern, ein kurzer Draht zu unserem Team.
            </p>
          </RevealOnScroll>
        </div>

        {/* Bento-Grid mit 5 Fotos vom VIDEOCOMET-Day */}
        <div className="grid grid-cols-6 grid-rows-2 gap-3 md:gap-4 mb-10 md:mb-14 aspect-[16/10]">
          <RevealOnScroll delay={100} className="col-span-4 row-span-2">
            <PhotoTile
              src="/community/vc-day-buehne.jpg"
              alt="Speaker vor dem Publikum beim VIDEOCOMET-Day in Würzburg"
              caption="VIDEOCOMET-Day · Würzburg"
              size="lg"
            />
          </RevealOnScroll>
          <RevealOnScroll delay={220} className="col-span-2 row-span-1">
            <PhotoTile
              src="/community/vc-day-speaker.jpg"
              alt="Speaker mit Headset präsentiert Kunden-Awareness-Phasen"
            />
          </RevealOnScroll>
          <RevealOnScroll delay={340} className="col-span-1 row-span-1">
            <PhotoTile
              src="/community/vc-day-lanyards.jpg"
              alt="VIDEOCOMET-Lanyards für Teilnehmer"
            />
          </RevealOnScroll>
          <RevealOnScroll delay={460} className="col-span-1 row-span-1">
            <PhotoTile
              src="/community/vc-day-notizen.jpg"
              alt="Teilnehmer macht Notizen während des Vortrags"
            />
          </RevealOnScroll>
        </div>

        {/* Speaker-Line-up + Standort */}
        <RevealOnScroll delay={200}>
          <Squircle
            radius={28}
            shadow="pretty"
            className="bg-[#f8f7fd] p-6 md:p-8"
          >
            <div className="grid gap-6 md:grid-cols-[auto_1fr] md:gap-10 items-center">
              <div className="flex items-center gap-3 md:border-r md:border-line md:pr-10">
                <span className="inline-flex size-11 items-center justify-center rounded-full bg-white text-brand-deep shadow-sm">
                  <MapPin className="size-5" />
                </span>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-muted">
                    Nächster Event
                  </div>
                  <div className="text-[15px] font-semibold text-ink mt-0.5">
                    VIDEOCOMET-Day, Würzburg
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-muted mb-3">
                  Bisherige Speaker
                </div>
                <div className="flex flex-wrap gap-2">
                  {SPEAKERS.map((s) => (
                    <span
                      key={s.name}
                      className="inline-flex items-baseline gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] shadow-sm"
                    >
                      <span className="font-semibold text-ink">{s.name}</span>
                      <span className="text-ink-muted">· {s.company}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Squircle>
        </RevealOnScroll>
      </div>
    </section>
  );
}

function PhotoTile({
  src,
  alt,
  caption,
  size = "sm",
}: {
  src: string;
  alt: string;
  caption?: string;
  size?: "sm" | "lg";
}) {
  return (
    <Squircle
      radius={size === "lg" ? 28 : 20}
      shadow="pretty"
      wrapperClassName="h-full w-full"
      className="relative h-full w-full bg-ink"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 size-full object-cover"
        loading="lazy"
      />
      {caption ? (
        <>
          <span className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent" />
          <span className="absolute bottom-3 left-4 text-white text-[13px] font-medium drop-shadow">
            {caption}
          </span>
        </>
      ) : null}
    </Squircle>
  );
}
