FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY bin ./bin
ENV PORT=8081
EXPOSE 8081
CMD ["node", "src/http.js"]
