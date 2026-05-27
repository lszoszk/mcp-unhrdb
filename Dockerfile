# Container image for the HTTP (Streamable HTTP) entry point — for hosting
# the connector remotely (Cowork, claude.ai, registry). The stdio entry
# (src/index.js) doesn't need a container; it's spawned by the client.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Install deps first so source-only changes reuse this layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# Listen locally by default; a fronting proxy (nginx) terminates TLS and
# exposes it publicly. Override with -e HOST=0.0.0.0 to expose directly.
ENV HOST=127.0.0.1 \
    PORT=8004

EXPOSE 8004
CMD ["node", "src/http.js"]
