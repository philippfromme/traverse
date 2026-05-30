FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY viewer/ viewer/
COPY scripts/build-index.js scripts/build-index.js

ENV DATA_DIR=/app/data
RUN mkdir -p /app/data/fit /app/data/gpx /app/data/tcx

EXPOSE 3000

CMD ["npm", "start"]
