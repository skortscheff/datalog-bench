# Simple database service: node:http + node:sqlite (both built into Node,
# zero extra dependencies), storing every uploaded log with a content-hash
# dedup key. Persisted to a named volume mounted at /data.
# node:sqlite needs Node >=22.13 without a flag; the web build stage uses the same node:24.
# Pin by digest (node:24-slim@sha256:<digest>) for reproducible builds.

# --- stage 1: test gate ---
FROM node:24-slim AS test
WORKDIR /src
COPY . .
RUN node --test test/db.test.mjs

# --- stage 2: runtime ---
FROM node:24-slim AS runtime
RUN groupadd -g 10001 appuser && useradd -u 10001 -g 10001 -M appuser
WORKDIR /app
COPY db/server.mjs ./server.mjs
COPY src/02-parse.js src/03-analyze.js ./engine-src/
# Forces this stage to depend on "test" actually succeeding: BuildKit only
# runs a stage referenced by --from once, and only if it completed. The file
# itself isn't used at runtime.
COPY --from=test /src/package.json ./package.json
RUN mkdir -p /data && chown -R appuser:appuser /app /data
ENV DB_PATH=/data/datalogs.db
ENV PORT=8080
USER appuser
EXPOSE 8080
CMD ["node", "--no-warnings", "server.mjs"]
