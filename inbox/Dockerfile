# Private inbox for messages left on the site. No dependencies; data on the volume at /data.
FROM node:22-slim
WORKDIR /app
COPY server.mjs ./
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
