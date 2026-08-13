# 線上簽核系統 — Synology NAS / Docker
FROM node:22-bookworm-slim

WORKDIR /app

# 系統工具（PDF 中文字型改由專案 fonts/ 提供單一 TTF，避免 .ttc 亂碼）
# openssl：首次啟動產生 HTTPS 自簽憑證
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fontconfig \
    openssl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/fonts

# 先裝依賴（利於 Docker layer cache）
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# 應用程式 + 中文字型（請在建置前放入 fonts/kaiu.ttf 或 NotoSans*.otf）
COPY server ./server
COPY public ./public
COPY fonts ./fonts
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

# 資料目錄（實際資料請用 volume 掛載）
RUN mkdir -p /app/data/uploads /app/data/backups /app/data/mail-outbox /app/data/certs /app/data/branding \
    && chmod +x /app/docker-entrypoint.sh \
    && chown -R node:node /app

ENV NODE_ENV=production \
    PORT=3847 \
    HTTPS_PORT=3848 \
    HTTPS_ENABLED=1 \
    TZ=Asia/Taipei

USER node
EXPOSE 3847 3848

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3847)+'/api/departments').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
