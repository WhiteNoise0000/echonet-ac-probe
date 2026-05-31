FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=build /app/node_modules ./node_modules
COPY src/ ./src/
COPY config.example.json ./

ENV NODE_ENV=production
ENV CONFIG_PATH=/config/config.json

EXPOSE 3000

LABEL org.opencontainers.image.source=https://github.com/WhiteNoise0000/echonet-ac-probe
LABEL org.opencontainers.image.description="Read-only ECHONET Lite monitor for nocria air conditioners"
LABEL org.opencontainers.image.licenses=MIT

USER appuser

CMD ["node", "src/server.js"]
