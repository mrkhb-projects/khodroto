FROM node:22-alpine
WORKDIR /srv/khodroto-relay
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY deploy/divar-relay.mjs ./divar-relay.mjs
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["node", "divar-relay.mjs"]
