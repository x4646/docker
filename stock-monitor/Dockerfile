FROM node:20-alpine

WORKDIR /app

# Copy backend
COPY backend/package.json ./backend/
RUN cd backend && npm install --production

COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Data dir
RUN mkdir -p /data

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "backend/server.js"]
