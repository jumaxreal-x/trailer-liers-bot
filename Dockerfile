FROM node:20-alpine

WORKDIR /app

# baileys pulls some deps from git + builds native modules
RUN apk add --no-cache git python3 make g++

# copy manifest first for caching
COPY package.json ./

RUN npm install --omit=dev --no-audit --no-fund

# copy source + config
COPY src ./src
COPY railway.json* ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/web.js"]
