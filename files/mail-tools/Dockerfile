FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY server.js ./server.js
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./server.js
COPY --from=build /app/dist ./dist

EXPOSE 8091
CMD ["npm", "start"]
