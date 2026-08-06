# syntax=docker/dockerfile:1.7
FROM node:24.18.1-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY scripts ./scripts
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:24.18.1-alpine AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4178
WORKDIR /app
RUN apk add --no-cache git && addgroup -S portal && adduser -S -G portal -u 10001 portal
COPY --from=build --chown=portal:portal /app/node_modules ./node_modules
COPY --from=build --chown=portal:portal /app/package.json ./package.json
COPY --from=build --chown=portal:portal /app/dist ./dist
COPY --chown=portal:portal workspace-portal.config.json ./workspace-portal.config.json
USER portal
EXPOSE 4178
CMD ["node", "dist/server/server/main.js"]
