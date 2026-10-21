# android-use as a remote MCP connector (Streamable HTTP on :3333/mcp).
#   docker build -t android-use .
#   docker run -d -p 127.0.0.1:3333:3333 -e MCP_AUTH_TOKEN=... -e ADB_SERIAL=<ip:port> -v android-use-adb:/root/.android android-use
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends adb ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json README.md LICENSE ./
ENV MCP_TRANSPORT=http HOST=0.0.0.0 PORT=3333 NODE_ENV=production
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3333/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
