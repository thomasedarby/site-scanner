FROM node:22-bookworm-slim

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json* ./
RUN npm install

COPY backend/ ./
COPY frontend/ /app/frontend/

RUN npm run build

EXPOSE 8080

CMD ["npm", "start"]
