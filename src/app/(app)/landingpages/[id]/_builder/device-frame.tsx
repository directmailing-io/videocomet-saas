"use client";

/**
 * DeviceFrame — echter <iframe> fuer die Geraete-Vorschau.
 *
 * Ein schmaler Wrapper-Div reicht nicht: Tailwind-Breakpoints (sm/md/lg)
 * sind Viewport-Media-Queries und wuerden im 390px-Rahmen weiter das
 * Desktop-Layout rendern. Der iframe hat einen eigenen Viewport in
 * Rahmenbreite, dadurch greifen die Breakpoints wie auf einem echten
 * Geraet. Die Kinder werden per React-Portal in den iframe-Body gerendert,
 * bleiben also Teil des React-Trees (Inline-Editing, Callbacks, State
 * funktionieren unveraendert).
 *
 * Stylesheets: beim Mount werden alle <link rel="stylesheet"> und <style>
 * aus dem Eltern-Dokument in den iframe-Head kopiert; eine MutationObserver-
 * Bruecke haelt sie aktuell (Dev-HMR, lazy geladene Styles).
 */

import * as React from "react";
import { createPortal } from "react-dom";

export function DeviceFrame({
  width,
  className,
  children,
}: {
  width: number;
  className?: string;
  children: React.ReactNode;
}) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [mountNode, setMountNode] = React.useState<HTMLElement | null>(null);
  const [height, setHeight] = React.useState(600);

  React.useEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;

    doc.documentElement.className = document.documentElement.className;
    doc.body.className = document.body.className;
    doc.body.style.margin = "0";
    doc.body.style.background = "transparent";

    const syncStyles = () => {
      doc.head
        .querySelectorAll("[data-device-frame-copy]")
        .forEach((n) => n.remove());
      document.head
        .querySelectorAll('link[rel="stylesheet"], style')
        .forEach((node) => {
          const clone = node.cloneNode(true) as HTMLElement;
          clone.setAttribute("data-device-frame-copy", "");
          doc.head.appendChild(clone);
        });
    };
    syncStyles();

    const headObserver = new MutationObserver(syncStyles);
    headObserver.observe(document.head, { childList: true, subtree: true });

    const resize = new ResizeObserver(() => {
      setHeight(doc.documentElement.scrollHeight);
    });
    resize.observe(doc.documentElement);
    resize.observe(doc.body);

    setMountNode(doc.body);
    return () => {
      headObserver.disconnect();
      resize.disconnect();
      setMountNode(null);
    };
  }, []);

  return (
    <iframe
      ref={iframeRef}
      title="Geräte-Vorschau"
      className={className}
      style={{ width, height, border: "0", display: "block" }}
    >
      {mountNode ? createPortal(children, mountNode) : null}
    </iframe>
  );
}
