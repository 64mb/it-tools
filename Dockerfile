# syntax=docker/dockerfile:1.7

FROM node:24.18.0-alpine3.23@sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436 AS build-stage

ARG BASE_URL=/
ENV CI=true \
    BASE_URL=${BASE_URL} \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm fetch --frozen-lockfile

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --offline --frozen-lockfile && \
    case "$BASE_URL" in /|/*/) ;; *) echo 'BASE_URL must start and end with /' >&2; exit 1 ;; esac && \
    pnpm build

FROM nginxinc/nginx-unprivileged:1.30.4-alpine3.24@sha256:45ce1e2e699234253d1def7baa96218a5d00b498d1ba0cbb1a17b6bdf73d1351 AS production-stage

USER root
RUN apk add --no-cache --upgrade 'libexpat>=2.8.4-r0'

ENV NGINX_PORT=8080

COPY --from=build-stage --chown=0:0 /app/dist /usr/share/nginx/html
COPY --chown=0:0 nginx.conf /etc/nginx/nginx.conf
COPY --chown=0:0 nginx-site.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=0555 docker-entrypoint.sh /usr/local/bin/it-tools-entrypoint

USER 101:101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${NGINX_PORT}/healthz" || exit 1

ENTRYPOINT ["/usr/local/bin/it-tools-entrypoint"]
