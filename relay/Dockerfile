FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
ENV PORT=8080
ENV RELAY_DATA_PATH=/data/relay-state.json
VOLUME ["/data"]
EXPOSE 8080

USER node
CMD ["node", "server.mjs"]
