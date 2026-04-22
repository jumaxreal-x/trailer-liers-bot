FROM node:20-alpine

WORKDIR /app

# install pnpm
RUN npm i -g pnpm@10

# copy lockfile + manifest first for caching
COPY package.json ./
RUN pnpm install --prod --no-frozen-lockfile

# copy source
COPY src ./src

ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/web.js"]
