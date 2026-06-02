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
   *
   * Also wires mute/unmute via the `volumechange` event — fires only on
   * EDGE transitions (muted→unmuted, unmuted→muted), not every volume
   * tick. Payload contains the video position at the time of the change.
   */
  function bindVideo(el) {
    try {
      if (!el || el.__vcVideoBound) return;
      el.__vcVideoBound = true;
      var lastProgressSec = 0;
      var playFired = false;
      // Track muted-state edges so we don't spam events on volume slides.
      var wasMuted = !!el.muted;

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

      el.addEventListener(
        "volumechange",
        function () {
          try {
            var nowMuted = !!el.muted;
            if (nowMuted === wasMuted) return;
            wasMuted = nowMuted;
            sendEvent(nowMuted ? "video_mute" : "video_unmute", {
              at: Math.floor(el.currentTime || 0),
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

  // ─── Scroll depth ──────────────────────────────────────────────────────
  /**
   * Tracks the deepest scroll point as a percentage of the document height.
   * Fires at most once per 10% step (10/20/.../100). Anchored on the bottom
   * of the visible viewport so a short doc on a tall screen still hits 100.
   */
  function bindScrollDepth() {
    try {
      var fired = {};
      var maxPct = 0;
      var pending = false;

      function compute() {
        try {
          var doc = document.documentElement || {};
          var body = document.body || {};
          var scrollTop = window.pageYOffset || doc.scrollTop || body.scrollTop || 0;
          var viewport = window.innerHeight || doc.clientHeight || 0;
          var fullHeight = Math.max(
            body.scrollHeight || 0,
            doc.scrollHeight || 0,
            body.offsetHeight || 0,
            doc.offsetHeight || 0,
            viewport,
          );
          if (fullHeight <= 0) return;
          var pct = Math.round(((scrollTop + viewport) / fullHeight) * 100);
          if (pct < 0) pct = 0;
          if (pct > 100) pct = 100;
          // Round down to a 10-step bucket.
          var bucket = Math.floor(pct / 10) * 10;
          if (bucket > maxPct && bucket > 0 && !fired[bucket]) {
            fired[bucket] = true;
            maxPct = bucket;
            sendEvent("scroll_depth", { maxPct: bucket });
          }
        } catch (e) {}
      }

      function onScroll() {
        if (pending) return;
        pending = true;
        // rAF coalesces bursts into one compute per frame.
        var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
        raf(function () {
          pending = false;
          compute();
        });
      }
      window.addEventListener("scroll", onScroll, { passive: true });
      // Initial measure so a short page that fits in the viewport on load
      // still emits a 100% event.
      compute();
    } catch (e) {
      /* swallow */
    }
  }

  // ─── Time on page ──────────────────────────────────────────────────────
  /**
   * Periodic + final time-on-page tracker. Sends an update every 15s and
   * a final update on visibilitychange→hidden / pagehide. Uses sendBeacon
   * for the final flush so the event survives navigation.
   *
   * Counts only foreground time — when the tab is hidden, the timer is
   * paused so we don't credit a user for closing the laptop on the LP.
   */
  function bindTimeOnPage() {
    try {
      var INTERVAL_SEC = 15;
      var totalSec = 0;
      var lastTickAt = Date.now();
      var visible =
        typeof document.visibilityState === "string"
          ? document.visibilityState !== "hidden"
          : true;
      var lastSentSec = 0;
      var timer = null;
      var finalSent = false;

      function bumpForeground() {
        var now = Date.now();
        if (visible) {
          totalSec += Math.max(0, Math.floor((now - lastTickAt) / 1000));
        }
        lastTickAt = now;
      }

      function tick() {
        bumpForeground();
        if (totalSec > lastSentSec) {
          lastSentSec = totalSec;
          sendEvent("time_on_page", { seconds: totalSec });
        }
      }

      function start() {
        if (timer != null) return;
        lastTickAt = Date.now();
        timer = setInterval(tick, INTERVAL_SEC * 1000);
      }
      function stop() {
        if (timer != null) {
          clearInterval(timer);
          timer = null;
        }
      }

      function onVisibility() {
        try {
          bumpForeground();
          var nowVisible =
            typeof document.visibilityState === "string"
              ? document.visibilityState !== "hidden"
              : true;
          if (nowVisible && !visible) {
            visible = true;
            lastTickAt = Date.now();
            start();
          } else if (!nowVisible && visible) {
            visible = false;
            stop();
            // Flush the accumulated time on background.
            if (totalSec > lastSentSec) {
              lastSentSec = totalSec;
              sendEvent("time_on_page", { seconds: totalSec });
            }
          }
        } catch (e) {}
      }

      function flushFinal() {
        if (finalSent) return;
        finalSent = true;
        try {
          bumpForeground();
          // Always send the absolute total so the server can take MAX().
          sendEvent("time_on_page", { seconds: totalSec, final: true });
        } catch (e) {}
        stop();
      }

      document.addEventListener("visibilitychange", onVisibility, false);
      window.addEventListener("pagehide", flushFinal, false);
      // Some browsers fire `beforeunload` more reliably than `pagehide`.
      window.addEventListener("beforeunload", flushFinal, false);
      start();
    } catch (e) {
      /* swallow */
    }
  }

  // ─── Link clicks (non-CTA) ─────────────────────────────────────────────
  /**
   * Capture-phase listener on the document for any <a>-click that ISN'T
   * already a CTA. We avoid double-tracking by skipping elements marked
   * with __vcCtaBound (set by `bindCtas`).
   */
  function bindLinkClicks() {
    try {
      document.addEventListener(
        "click",
        function (ev) {
          try {
            var target = ev.target;
            var a = null;
            while (target && target !== document) {
              if (target.tagName === "A") {
                a = target;
                break;
              }
              target = target.parentNode;
            }
            if (!a) return;
            if (a.__vcCtaBound) return; // already a CTA, skip.
            var href = "";
            var text = "";
            try {
              href = a.getAttribute("href") || "";
            } catch (e) {}
            try {
              text = (a.textContent || "").trim().slice(0, 120);
            } catch (e) {}
            if (!href) return;
            sendEvent("link_click", { href: href, text: text });
          } catch (e) {}
        },
        true,
      );
    } catch (e) {
      /* swallow */
    }
  }

  // ─── CTA hover ─────────────────────────────────────────────────────────
  /**
   * "Near-miss" signal — the cursor sat on a CTA for >800ms but no click
   * fired. Reset on every mouseleave or click. One event per hover-burst
   * per element. Skipped on touch-only devices (no mouseenter semantics).
   */
  function bindCtaHover() {
    try {
      var HOVER_THRESHOLD_MS = 800;
      var elements = [];
      function collect(selector, position) {
        if (!selector || typeof selector !== "string") return;
        $$(selector).forEach(function (el) {
          if (!el || el.__vcHoverBound) return;
          el.__vcHoverBound = true;
          elements.push({ el: el, position: position });
        });
      }
      if (typeof ANNO.primaryCta === "string") collect(ANNO.primaryCta, "primary");
      if (typeof ANNO.secondaryCta === "string") collect(ANNO.secondaryCta, "secondary");
      collect("[data-vc-cta]", "convention");

      elements.forEach(function (entry) {
        var el = entry.el;
        var enterAt = 0;
        var timeoutId = null;
        var clicked = false;

        function clear() {
          if (timeoutId != null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        }

        el.addEventListener("mouseenter", function () {
          try {
            enterAt = Date.now();
            clicked = false;
            clear();
            timeoutId = setTimeout(function () {
              // Threshold reached without a click. We still send the
              // event; the actual hover may continue but we only fire
              // once per hover-burst.
              try {
                if (clicked) return;
                var label = "";
                try {
                  label = (el.textContent || "").trim().slice(0, 120);
                } catch (e) {}
                sendEvent("cta_hover", {
                  label: label,
                  durationMs: Date.now() - enterAt,
                  position: entry.position,
                });
              } catch (e) {}
              timeoutId = null;
            }, HOVER_THRESHOLD_MS);
          } catch (e) {}
        });
        el.addEventListener("mouseleave", function () {
          clear();
        });
        el.addEventListener("click", function () {
          clicked = true;
          clear();
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
    try {
      bindScrollDepth();
    } catch (e) {}
    try {
      bindTimeOnPage();
    } catch (e) {}
    try {
      bindLinkClicks();
    } catch (e) {}
    try {
      bindCtaHover();
    } catch (e) {}
  });
})();
