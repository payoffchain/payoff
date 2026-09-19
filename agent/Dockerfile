# The auto-repay runner, on its own: only what it imports, no Next build and none of the
# site's front-end dependencies. Built by Railway (see railway.json). The key arrives as
# AGENT_PRIVATE_KEY at run time.
FROM node:22-slim
WORKDIR /app
RUN npm init -y >/dev/null && npm pkg set type=module && npm install --omit=dev --no-audit --no-fund ethers@6.17.0 @anthropic-ai/sdk@0.124.0
COPY agent ./agent
COPY lib/abis ./lib/abis
ENV NODE_ENV=production HOST=0.0.0.0
USER node
CMD ["node", "agent/index.mjs"]
