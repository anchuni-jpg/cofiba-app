# Para hostings que usan Docker (Railway, Render, Fly.io, Coolify, un VPS
# con Docker...). Construye y arranca la app tal cual.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data
VOLUME /data
EXPOSE 4000
CMD ["node", "server/src/index.js"]
