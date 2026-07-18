# MeridianOS core — L2 packaging (Docker)
#
# This image packages the **gateway sidecar** (`gateway/cli.mjs`, bin `meridian-gateway`) as its
# default runnable service, because it is the ONLY entrypoint in this repo that is genuinely
# tenant-agnostic: no `DomainPlugin`, no tenant loop, no baked-in config (see gateway/README.md).
#
# The full daemon (`scheduler.mjs`) is NOT runnable standalone from this image: `config.mjs`
# THROWS if no `DomainPlugin` is injected, and this core ships zero tenant defaults by design
# (docs/README.md, "no default tenant"). A tenant that wants the daemon builds their OWN image
# `FROM` this one (or mounts their composition-root entry script as a volume) that imports
# `scheduler.mjs`'s `start({ domain })` with their own plugin — see docs/DEPLOY.md for the pattern.
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
