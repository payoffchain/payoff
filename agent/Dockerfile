# The auto-repay runner, on its own: runtime dependencies only, no Next build.
# Built by Railway (see railway.json). The key arrives as AGENT_PRIVATE_KEY at run time.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY agent ./agent
COPY lib/abis ./lib/abis
ENV NODE_ENV=production HOST=0.0.0.0
CMD ["node", "agent/index.mjs"]
