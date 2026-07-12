FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src ./src

RUN npm run build
RUN mkdir -p uploads

ENV NODE_ENV=production
EXPOSE 4000

CMD ["npm", "start"]
