"use client";

import * as React from "react";
import { Play } from "lucide-react";
import { RevealOnScroll } from "./RevealOnScroll";
import { Squircle } from "./Squircle";

const TESTIMONIALS: ReadonlyArray<{
  vimeoSrc: string;
  thumb: string;
  result: string;
  quote: string;
  name: string;
  role: string;
}> = [
  {
    vimeoSrc:
      "https://player.vimeo.com/video/848457306?h=9e9f00c1a6&dnt=1&autoplay=1",
    thumb: "/testimonials/matthias.jpg",
    result: "Neue Zielgruppen in Tagen getestet",
    quote:
      "Es wird einfach alles generiert. Wir müssen nur noch ausdrucken und zur Post bringen. So testen wir ganz schnell neue Zielgruppen und finden die Botschaft, die am besten zündet.",
    name: "Matthias Schäfer",
    role: "Gründer, MS Marketing Solutions GmbH",
  },
  {
    vimeoSrc: "https://player.vimeo.com/video/756176209?dnt=1&autoplay=1",
    thumb: "/testimonials/sebastian.jpg",
    result: "Neue Kunden, bessere Bestandsbetreuung",
    quote:
      "Ich habe neue Kunden gewonnen und kann meine Bestandskunden besser betreuen. VIDEOCOMET nimmt mir die Arbeit in der Neukundengewinnung einfach ab.",
    name: "Sebastian Dittmar",
    role: "Schornsteinfegermeister, Berlin",
  },
  {
    vimeoSrc: "https://player.vimeo.com/video/746107405?dnt=1&autoplay=1",
    thumb: "/testimonials/wladimir.jpg",
    result: "Mailings, über die Empfänger reden",
    quote:
      "Wenn ich so ein Mailing bekommen würde, würde mich brennend interessieren: Wie haben die das gemacht? Man lädt die Daten hoch, um den Rest kümmert sich das Team. Null Stress.",
    name: "Wladimir Simonov",
    role: "Geschäftsführer, Simonov Consulting GmbH",
  },
];

export function TestimonialsSection() {
  return (
    <section
      id="testimonials"
      className="relative z-[2] w-full bg-white py-16 md:py-32"
    >
      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <div className="max-w-2xl mx-auto text-center mb-12 md:mb-16">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold tracking-[0.18em] uppercase mb-6">
              Kundenstimmen
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={100}>
            <h2 className="font-light tracking-[-0.035em] text-ink leading-[1.05] text-[clamp(32px,4.2vw,56px)] mb-5 text-balance">
              Rund 250.000 personalisierte
              <br />
              <span className="font-semibold text-brand-deep">
                Videos seit 2022.
              </span>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={200}>
            <p className="text-ink-muted text-lg leading-relaxed text-balance max-w-xl mx-auto">
              Agenturen, Handwerksbetriebe, Coaches: ganz unterschiedliche
              Branchen, derselbe Effekt. Drei von ihnen erzählen dir, warum.
            </p>
          </RevealOnScroll>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 items-stretch">
          {TESTIMONIALS.map((t, i) => (
            <RevealOnScroll key={t.name} delay={100 + i * 150}>
              <TestimonialCard testimonial={t} />
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}

function TestimonialCard({
  testimonial,
}: {
  testimonial: (typeof TESTIMONIALS)[number];
}) {
  const [playing, setPlaying] = React.useState(false);
  return (
    <Squircle
      radius={28}
      shadow="pretty"
      wrapperClassName="h-full"
      className="bg-[#f8f7fd] p-5 md:p-6 flex flex-col h-full"
    >
      <Squircle radius={18} className="relative aspect-video bg-ink">
        {playing ? (
          <iframe
            src={testimonial.vimeoSrc}
            className="absolute inset-0 size-full"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            title={`Kundenstimme von ${testimonial.name}`}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 size-full flex items-center justify-center"
            aria-label={`Video von ${testimonial.name} abspielen`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={testimonial.thumb}
              alt=""
              className="absolute inset-0 size-full object-cover"
              loading="lazy"
            />
            <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/55 to-transparent" />
            <span className="relative size-14 rounded-full bg-white/95 backdrop-blur-md flex items-center justify-center shadow-[0_10px_28px_-8px_rgba(15,23,42,0.45)] transition-transform group-hover:scale-105">
              <Play
                className="size-5 text-ink translate-x-[1px]"
                fill="currentColor"
              />
            </span>
            <span className="absolute bottom-2.5 inset-x-0 text-center text-[11px] font-medium text-white/90 drop-shadow">
              Klick lädt das Video von Vimeo
            </span>
          </button>
        )}
      </Squircle>
      <div className="mt-4">
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
          {testimonial.result}
        </span>
      </div>
      <blockquote className="text-[14.5px] leading-relaxed text-ink-soft mt-3 flex-1">
        &bdquo;{testimonial.quote}&ldquo;
      </blockquote>
      <div className="mt-4 pt-4 border-t border-line">
        <div className="text-[15px] font-semibold text-ink leading-tight">
          {testimonial.name}
        </div>
        <div className="text-[12.5px] text-ink-muted mt-0.5">
          {testimonial.role}
        </div>
      </div>
    </Squircle>
  );
}
