FROM node:24-alpine
WORKDIR /app
COPY waha ./waha
COPY kapso/build ./kapso/build
COPY kapso/functions ./kapso/functions
WORKDIR /app/waha
ENV APP_HOST=0.0.0.0
CMD ["node", "src/main.js"]
