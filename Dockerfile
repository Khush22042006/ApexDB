FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --chown=node:node .env.example ./.env.example
USER node
EXPOSE 4000
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
