FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ src/
COPY drizzle/ drizzle/
COPY drizzle.config.ts tsconfig.json ./

# Create data directory
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/trader.db

CMD ["bun", "src/index.ts"]
