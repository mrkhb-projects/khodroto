FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
# Build-only packages live in devDependencies, so the build stage needs them
# explicitly while the runtime image below ships production deps only.
RUN npm ci --include=dev

FROM deps AS build
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=5173
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/src/server ./src/server
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 5173
CMD ["node","server.js"]
