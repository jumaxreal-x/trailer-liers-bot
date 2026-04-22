FROM node:20-alpine

WORKDIR /app

# copy manifest first for caching
COPY package.json ./

# install with npm (no lockfile needed; baileys deps work fine)
RUN npm install --omit=dev --no-audit --no-fund

# copy source + config
COPY src ./src
COPY railway.json* ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/web.js"]
