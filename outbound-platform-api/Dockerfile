FROM node:22-alpine AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY outbound-contracts/package.json ./outbound-contracts/package.json
COPY outbound-platform-api/package.json ./outbound-platform-api/package.json
RUN npm ci --workspace @outbound/contracts --workspace @outbound/platform-api --include-workspace-root=false

COPY outbound-contracts ./outbound-contracts
COPY outbound-platform-api ./outbound-platform-api
RUN npm run build --workspace @outbound/contracts && npm run build --workspace @outbound/platform-api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/outbound-contracts/package.json ./outbound-contracts/package.json
COPY --from=build /workspace/outbound-contracts/dist ./outbound-contracts/dist
COPY --from=build /workspace/outbound-platform-api/package.json ./outbound-platform-api/package.json
COPY --from=build /workspace/outbound-platform-api/dist ./outbound-platform-api/dist
USER node
EXPOSE 8788
CMD ["node", "outbound-platform-api/dist/server.js"]
