# ─── Stage 1: Build ───────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json pnpm-lock.yaml* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install
COPY . .
RUN npm run build

# ─── Stage 2: Runtime (standalone) ────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
