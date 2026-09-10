FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
CMD ["npx", "ts-node-dev", "--respawn", "--transpile-only", "--no-notify", "server.js"]
