FROM node:24.21.0-alpine

WORKDIR /app
COPY server.mjs main.mjs ./
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production PORT=8080 DATA_PATH=/data/free360.sqlite
EXPOSE 8080
CMD ["node", "main.mjs"]
