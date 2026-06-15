# syntax=docker/dockerfile:1
# Install deps only after full workspace is copied so npm workspaces (shared/server/web) resolve — including zod for @gym/shared.
FROM node:22-bookworm-slim AS base
WORKDIR /app

RUN apt-get update -qq \
  && apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3 \
  && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000

CMD ["node", "server/dist/index.js"]
