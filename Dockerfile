# syntax=docker/dockerfile:1

# ---- 依赖构建阶段（better-sqlite3 含原生模块；有预编译二进制，构建工具仅为兜底）----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# ---- 运行阶段 ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# 非 root 用户运行
RUN chown -R node:node /app
USER node

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node shared ./shared

# SQLite 数据文件目录（由 Compose 挂载卷持久化）
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV HOST=0.0.0.0
ENV PORT=3000
ENV DB_PATH=/app/data/lx-cue.db

EXPOSE 3000

# 容器内简单健康检查
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
