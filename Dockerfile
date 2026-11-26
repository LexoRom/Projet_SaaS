# Étape 1 : compilation de l'interface React.
FROM node:22-alpine AS client
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# Étape 2 : API Node.js, qui sert aussi l'interface compilée.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/src ./src
COPY --from=client /client/dist ./public
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
