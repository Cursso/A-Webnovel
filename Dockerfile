FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY index.html styles.css app.js server.js ./
ENV NODE_ENV=production
ENV PORT=4173
ENV DATA_DIR=/data
EXPOSE 4173
CMD ["node", "server.js"]
