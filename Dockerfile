# MeridianOS core — L2 packaging (Docker)
#
# This image packages the **gateway sidecar** (`gateway/cli.mjs`, bin `meridian-gateway`) as its
# default runnable service. The full daemon can also run from this same image via
# `daemon-entry.mjs` when a `.ai/tenant.yaml` is volume-mounted — no custom build required.
#
# BYO-key invariant: no API keys or other secret literals are ever baked into this image. Every
# provider key is supplied at container *runtime* via an env var NAME (e.g. `DEEPSEEK_KEY`),
# resolved server-side inside the gateway — see providers.mjs `keyEnv`.

FROM node:24-slim AS base
WORKDIR /app

# Install dependencies first (better cache reuse across source-only changes).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the rest of the core. .dockerignore keeps node_modules/.git/tests/secrets/session-state out.
COPY . .

# Dashboard port (used only by a tenant-composed daemon, not by the standalone gateway CLI) and
# the gateway sidecar's own port. Both are configurable at runtime; these are just the documented
# defaults (see docs/DEPLOY.md).
EXPOSE 4317 8787

ENV NODE_ENV=production

# Default: boot the standalone gateway sidecar. Override `command:` in docker-compose.yml (or the
# container's CMD) to pass different flags, or to point at a tenant-provided daemon entrypoint.
ENTRYPOINT ["node", "gateway/cli.mjs"]
CMD ["--port", "8787"]
