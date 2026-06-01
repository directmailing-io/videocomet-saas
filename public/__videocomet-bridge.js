/* eslint-disable */
/*
 * VideoComet — Custom-LP Tracking-Bridge
 * Plain hand-written ES2018; no build, no transpile. Served as a static
 * asset by Next.js and injected by the Custom-LP renderer with:
 *   <script>window.__videocomet = { slug, lead, annotations }</script>
 *   <script src="/__videocomet-bridge.js" defer></script>
 *
 * Responsibility:
 *   - Fire `page_view` on DOM-ready
 *   - Bind CTA-click handlers from annotations + `[data-vc-cta]` fallback
 *   - Bind video play/progress/ended tracking from annotation videoSelector
 *     + `video[data-vc-track]` fallback
 *   - Track section visibility from annotation `sectionTracking[]`
 *   - Expose `window.videocomet = { lead, track(kind, payload) }`
 *
 * Iron-clad rules:
 *   - NEVER throw — every interaction wrapped in try/catch
 *   - NEVER block render — defer attribute on script + DOM-ready guard
 *   - NEVER hardcode the tracking URL host in HMTL — it lives only here
 *   - sendBeacon preferred (survives unload), fetch+keepalive fallback
 *   - No external dependencies
 */
(function () {
  "use strict";

  // ─── Config ────────────────────────────────────────────────────────────
  // Trailing-slash absent: endpoint is exactly this URL. Custom-LPs run on
  // lp.videocomet.de (or a future custom-domain) so we MUST go cross-origin
  // back to the main app. CORS is already open on this route.
  var TRACK_ENDPOINT = "https://app.videocomet.de/api/track/event";
  // Throttle progress events to every N seconds so video_progress doesn't
  // hammer the API on long videos.
  var PROGRESS_INTERVAL_SEC = 5;

  // ─── State pulled from the injected window.__videocomet ────────────────
  var STATE = (typeof window !== "undefined" && window.__videocomet) || {};
  var SLUG = typeof STATE.slug === "string" ? STATE.slug : "";
  var LEAD = STATE.lead && typeof STATE.lead === "object" ? STATE.lead : {};
  var ANNO =
    STATE.annotations && typeof STATE.annotations === "object"
      ? STATE.annotations
      : {};

  // ─── Public API ────────────────────────────────────────────────────────
  // Mounted on window so customer JS can call track("custom_thing", {...}).
  try {
    window.videocomet = {
      lead: LEAD,
      track: function (kind, payload) {
        sendEvent(kind, payload);
      },
    };
  } catch (e) {
    /* swallow */
  }

  // ─── Core sender ───────────────────────────────────────────────────────
  /**
   * Fire-and-forget event sender. Prefers sendBeacon so events outlast a
   * page unload (typical for cta_click → immediate navigate). Falls back
   * to fetch with keepalive when beacon is missing or refuses the blob.
   * NEVER throws, NEVER returns a promise the caller must await.
   */
  function sendEvent(kind, payload) {
    try {
      if (!SLUG) return;
      if (typeof kind !== "string" || !kind) return;
      var body = JSON.stringify({
        slug: SLUG,
        kind: kind,
        payload: payload || undefined,
      });
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function"
      ) {
        try {
          var blob = new Blob([body], { type: "application/json" });
          if (navigator.sendBeacon(TRACK_ENDPOINT, blob)) return;
        } catch (e) {
          /* fall through to fetch */
        }
      }
      if (typeof fetch === "function") {
        try {
          fetch(TRACK_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body,
            keepalive: true,
            credentials: "omit",
            mode: "cors",
          }).catch(function () {});
        } catch (e) {
          /* swallow */
        }
      }
    } catch (e) {
      /* swallow — tracking must never break the page */
    }
  }

  // ─── DOM helpers ───────────────────────────────────────────────────────
  function $$(selector) {
    if (!selector || typeof selector !== "string") return [];
    try {
      return Array.prototype.slice.call(document.querySelectorAll(selector));
    } catch (e) {
      return [];
    }
  }

  function ready(fn) {
    if (
      document.readyState === "complete" ||
      document.readyState === "interactive"
    ) {
      // Microtask defer so any inline init scripts after the bridge tag
      // still have time to mount their annotations.
      setTimeout(fn, 0);
      return;
    }
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  // ─── CTA binding ───────────────────────────────────────────────────────
  /**
   * Bind click → cta_click for elements matched by annotations OR the
   * `[data-vc-cta]` convention attribute. Multiple matches are all
   * bound. Duplicate binds across annotation + convention are de-duped
   * via a per-element flag.
   */
  function bindCtas() {
    var BOUND_FLAG = "__vcCtaBound";

    function bind(el, position) {
      try {
        if (!el || el[BOUND_FLAG]) return;
        el[BOUND_FLAG] = true;
        el.addEventListener(
          "click",
          function (ev) {
            try {
              var label = "";
              try {
                label = (el.textContent || "").trim().slice(0, 120);
              } catch (e) {}
              var url = "";
              try {
                url =
                  el.getAttribute("href") ||
                  el.dataset?.vcHref ||
                  "";
              } catch (e) {}
              sendEvent("cta_click", {
                position: position,
                label: label,
                url: url,
              });
            } catch (e) {
              /* swallow */
            }
            // Do NOT preventDefault — the link MUST follow normally.
            void ev;
          },
          { capture: false },
        );
      } catch (e) {
        /* swallow */
      }
    }

    if (typeof ANNO.primaryCta === "string" && ANNO.primaryCta) {
      $$(ANNO.primaryCta).forEach(function (el) {
        bind(el, "primary");
      });
    }
    if (typeof ANNO.secondaryCta === "string" && ANNO.secondaryCta) {
      $$(ANNO.secondaryCta).forEach(function (el) {
        bind(el, "secondary");
      });
    }
    // Convention fallback: any element marked with data-vc-cta.
    $$("[data-vc-cta]").forEach(function (el) {
      var pos = "";
      try {
        pos = el.getAttribute("data-vc-cta") || "convention";
      } catch (e) {
        pos = "convention";
      }
      bind(el, pos || "convention");
    });
  }

  // ─── Video binding ─────────────────────────────────────────────────────
  /**
   * Attach play / progress / ended trackers to one <video> element.
   * Progress events are throttled to PROGRESS_INTERVAL_SEC and we always
   * emit a final video_ended with the absolute current position.
   */
  function bindVideo(el) {
    try {
      if (!el || el.__vcVideoBound) return;
      el.__vcVideoBound = true;
      var lastProgressSec = 0;
      var playFired = false;

      el.addEventListener(
        "play",
        function () {
          try {
            if (playFired) return;
            playFired = true;
            sendEvent("video_play", { atSec: Math.floor(el.currentTime || 0) });
          } catch (e) {}
        },
        { passive: true },
      );

      el.addEventListener(
        "timeupdate",
        function () {
          try {
            var t = Math.floor(el.currentTime || 0);
            if (t - lastProgressSec >= PROGRESS_INTERVAL_SEC) {
              lastProgressSec = t;
              sendEvent("video_progress", {
                atSec: t,
                duration: Math.floor(el.duration || 0) || null,
              });
            }
          } catch (e) {}
        },
        { passive: true },
      );

      el.addEventListener(
        "ended",
        function () {
          try {
            sendEvent("video_ended", {
              atSec: Math.floor(el.currentTime || 0),
              duration: Math.floor(el.duration || 0) || null,
            });
          } catch (e) {}
        },
        { passive: true },
      );
    } catch (e) {
      /* swallow */
    }
  }

  function bindVideos() {
    if (typeof ANNO.videoSelector === "string" && ANNO.videoSelector) {
      $$(ANNO.videoSelector).forEach(function (el) {
        // Only bind native <video>; ignore other matches silently.
        if (el && typeof el.play === "function" && "currentTime" in el) {
          bindVideo(el);
        }
      });
    }
    // Convention fallback
    $$("video[data-vc-track]").forEach(function (el) {
      bindVideo(el);
    });
  }

  // ─── Section visibility ────────────────────────────────────────────────
  /**
   * Track which sections of the page enter the viewport. Fires once per
   * section per pageload (so a long scroll session doesn't spam events).
   * Uses IntersectionObserver where available; silently no-ops on older
   * browsers (IE11) where the API doesn't exist.
   */
  function bindSections() {
    try {
      if (!("IntersectionObserver" in window)) return;
      var selectors = Array.isArray(ANNO.sectionTracking)
        ? ANNO.sectionTracking.filter(function (s) {
            return typeof s === "string" && s.length > 0;
          })
        : [];
      if (selectors.length === 0) return;

      var fired = new WeakSet();
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            try {
              if (!entry.isIntersecting) return;
              if (fired.has(entry.target)) return;
              fired.add(entry.target);
              var sel = entry.target.getAttribute("data-vc-section") || "";
              sendEvent("section_view", {
                section: sel || entry.target.tagName.toLowerCase(),
              });
            } catch (e) {}
          });
        },
        { threshold: 0.4 },
      );

      selectors.forEach(function (selector) {
        $$(selector).forEach(function (el, idx) {
          try {
            // Tag with selector so the event payload is meaningful even
            // if the customer didn't add a data attribute.
            if (!el.getAttribute("data-vc-section")) {
              el.setAttribute("data-vc-section", selector + "#" + idx);
            }
            observer.observe(el);
          } catch (e) {}
        });
      });
    } catch (e) {
      /* swallow */
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────────
  ready(function () {
    try {
      sendEvent("page_view", {
        referrer:
          typeof document !== "undefined" ? document.referrer || "" : "",
        language:
          typeof navigator !== "undefined"
            ? navigator.language || ""
            : "",
        custom: true,
      });
    } catch (e) {}
    try {
      bindCtas();
    } catch (e) {}
    try {
      bindVideos();
    } catch (e) {}
    try {
      bindSections();
    } catch (e) {}
  });
})();
