# Etapa 1: Build
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Etapa 2: Produção
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY views ./views
COPY public ./public

# Não roda como root: se alguém explorar uma falha, o estrago fica limitado ao usuário "node"
USER node

EXPOSE 3033
CMD ["node", "dist/web/server.js"]