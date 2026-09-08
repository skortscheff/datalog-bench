# --- stage 1: build + test gate ---
# Node and Python together in one stage: build.py and the Gate 5 suite both run
# fast against the same src/ + fixtures/ tree, with no compiled artifact passing
# between separate stages that would benefit from being split further.
FROM node:20-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
ARG TILE_BASE=https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
RUN node test/run.mjs \
 && python3 build.py --tile-base "$TILE_BASE" --out /out/Datalog-Bench.html

# --- stage 2: static runtime ---
FROM nginx:1.27-alpine AS runtime
RUN adduser -D -H -u 10001 appuser \
    && mkdir -p /usr/share/nginx/html /var/cache/nginx /var/run \
    && chown -R appuser:appuser /usr/share/nginx/html /var/cache/nginx /var/run /var/log/nginx
COPY --from=build /out/Datalog-Bench.html /usr/share/nginx/html/index.html
COPY docker/nginx-web.conf /etc/nginx/conf.d/default.conf
COPY --chown=appuser:appuser docker/healthz.json /usr/share/nginx/html/healthz
COPY --chown=appuser:appuser docker/readyz.json  /usr/share/nginx/html/readyz
USER appuser
EXPOSE 8080
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA

# Run with --read-only + tmpfs mounts owned by uid/gid 10001 (docker's default
# tmpfs mode/ownership is root's, which nginx running as appuser can't write
# into), e.g.:
#   docker run --read-only \
#     --tmpfs /var/cache/nginx:uid=10001,gid=10001,mode=0755 \
#     --tmpfs /var/run:uid=10001,gid=10001,mode=0755 \
#     --tmpfs /tmp:uid=10001,gid=10001,mode=0755 \
#     -p 8080:8080 datalog-bench:test
