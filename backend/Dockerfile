# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies (including devDependencies for build tools)
COPY package*.json ./
# Use npm install (not ci) to handle cross-platform lock file differences
# between the Windows dev machine (npm 11) and this Alpine Linux image (npm 10)
RUN npm install --frozen-lockfile 2>/dev/null || npm install

# Copy Prisma schema and config first so prisma generate can run
COPY prisma ./prisma
COPY prisma.config.ts ./

# Generate Prisma client (writes to src/generated/prisma).
# DATABASE_URL is required by prisma.config.ts even for generate; pass a dummy value.
RUN DATABASE_URL=postgresql://dummy:dummy@dummy:5432/dummy npx prisma generate

# Compile TypeScript → dist/
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json


# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Install prisma CLI so we can run `prisma migrate deploy` on startup.
# prisma is a devDependency so it was excluded by --omit=dev; reinstall it here.
RUN npm install prisma@$(node -e "const p=require('./package.json'); console.log(p.devDependencies.prisma.replace(/^\^/,''))")

# Copy Prisma schema, migrations, and config — needed by prisma migrate deploy
COPY prisma ./prisma
COPY prisma.config.ts ./

# Re-run prisma generate in runtime stage so the client matches the runtime node_modules
RUN DATABASE_URL=postgresql://dummy:dummy@dummy:5432/dummy npx prisma generate

# Copy compiled application from build stage
COPY --from=build /app/dist ./dist

# Prisma 7 fix: tsc compiles the generated client to dist/generated/prisma/*.js but
# keeps the source's explicit `.ts` import extensions (Prisma 7 generates TS-only),
# which Node cannot resolve at runtime. Rewrite those import specifiers `.ts` -> `.js`
# in the compiled output. (Do NOT copy the raw .ts files over the .js — Node can't load .ts.)
RUN find dist/generated/prisma -name '*.js' -exec sed -i -e 's/\.ts"/.js"/g' -e "s/\.ts'/.js'/g" {} +

EXPOSE 3000

# Run migrations then start the API
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
