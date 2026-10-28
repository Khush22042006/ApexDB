FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_PATH=/data/apex.db
RUN mkdir -p /data && chown node:node /data
COPY package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --chown=node:node .env.example ./.env.example
USER node
EXPOSE 4000
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
