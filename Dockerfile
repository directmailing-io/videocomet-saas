# Multi-stage build for Next.js standalone output
FROM node:22-alpine AS deps
# Build tools for native modules (argon2 needs to compile from source on alpine/musl;
# sharp uses prebuilt linux-musl wheel so no vips-dev needed).
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --include=optional

FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time stub env so Next.js page-data collection passes;
# real values are injected at runtime.
ENV DATABASE_URL=postgres://stub:stub@localhost:5432/stub
ENV REDIS_URL=redis://localhost:6379
ENV COOKIE_SECRET=build_time_stub_secret_32chars_long
ENV SHARE_COOKIE_SECRET=00000000000000000000000000000000000000000000000000000000000000ab
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# ffmpeg: needed by /api/media/[id]/frame for the wizard's live thumbnail
# preview (single-frame extraction). Runs in-process for sub-200ms response —
# the worker queue would add too much latency for the interactive UI.
#
# chromium: needed by /api/gslides/import for the LEGACY pubembed-Pipeline,
# die für Bestandskampagnen Folien per Puppeteer screenshottet.
#
# libreoffice + poppler-utils: needed by /api/gslides/import (Edit-Mode-
# Pipeline) sowie /api/gslides/refresh. Wir laden den PPTX-Export einer
# Anyone-with-link-URL, lassen LibreOffice das Deck headless als PDF
# rendern und rastern danach mit pdftoppm pro Folie ein Thumbnail. Im
# Worker-Container ist dasselbe Toolchain bereits drin — wir spiegeln es
# in den App-Container, weil der Import synchron beim Klick passieren muss
# (kein Worker-Round-Trip akzeptabel für die UX).
RUN apk add --no-cache ffmpeg chromium \
  nss freetype harfbuzz ca-certificates ttf-freefont \
  font-noto-emoji \
  libreoffice poppler-utils
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV LIBREOFFICE_PATH=/usr/bin/libreoffice
ENV PDFTOPPM_PATH=/usr/bin/pdftoppm
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# argon2 and sharp need their native binaries copied into standalone
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/argon2 ./node_modules/argon2
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
