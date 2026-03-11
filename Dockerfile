FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
RUN npx playwright install --with-deps chromium

COPY src/ ./src/

VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:3000/api/health || exit 1

LABEL org.opencontainers.image.source=https://github.com/rvben/eboekhouden-api
LABEL org.opencontainers.image.licenses=MIT
LABEL org.opencontainers.image.description="e-Boekhouden API via browser automation"

CMD ["node", "src/server.mjs"]
