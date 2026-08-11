FROM oven/bun:1.3.5 AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY skills ./skills
RUN bun run build

FROM debian:trixie-slim AS spark
ARG SPARK_VERSION=0.9.1
ARG SPARK_LINUX_X64_SHA256=c18d2235e2b040fea04ce1938f96e8c133da8cd3e19fafd758dced1ad90457c1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --location --retry 3 \
      "https://github.com/ifBars/codex-spark-agent/releases/download/v${SPARK_VERSION}/spark-${SPARK_VERSION}-linux-x64.zip" \
      --output /tmp/spark.zip \
    && echo "${SPARK_LINUX_X64_SHA256}  /tmp/spark.zip" | sha256sum --check --strict \
    && unzip -q /tmp/spark.zip -d /tmp/spark \
    && install -m 0755 /tmp/spark/spark /usr/local/bin/spark

FROM node:24-trixie-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git ripgrep tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    XDG_DATA_HOME="/data/spark-data" \
    PATH="/app/node_modules/.bin:${PATH}"
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/skills ./skills
COPY --from=spark /usr/local/bin/spark /usr/local/bin/spark
RUN mkdir -p /data/codex-home /data/spark-data /data/workspaces \
    && chown -R node:node /app /data \
    && spark --version
USER node
EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/main.js"]
