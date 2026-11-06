FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .
RUN mkdir -p logs backups tickets && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "index.js"]
