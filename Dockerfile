# syntax=docker/dockerfile:1.7
# Next.js website. Build context is the repository root.
#   docker build --build-arg API_INTERNAL_URL=http://api:4000 -t wolfcar-web .
# API_INTERNAL_URL must be given at BUILD time: next.config.ts bakes the
# /api/* rewrite into the build, so a wrong value here breaks every uploaded
# image in production even if the runtime env is right.
# NEXT_PUBLIC_TAP_PUBLIC_KEY (Tap's pk_… key) is baked in the same way; it is
# also the switch for card checkout: built without it, the site offers WhatsApp only.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_TAP_PUBLIC_KEY=
# Node sizes its heap from physical RAM (~490 MB on a 1 GB droplet) and ignores
# swap, which is too little for next build's type check. Build step only.
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    NEXT_PUBLIC_TAP_PUBLIC_KEY=$NEXT_PUBLIC_TAP_PUBLIC_KEY \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=3072
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/en').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
