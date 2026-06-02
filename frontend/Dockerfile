# ── Stage 1: Build ─────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Optional build-arg overrides (from docker-compose build.args / root .env).
# When not passed, values in frontend/.env are used as the source of truth.
ARG VITE_API_URL
ARG VITE_ENGINE_URL
ARG VITE_ENGINE_API_KEY
ARG VITE_PAYPAL_CLIENT_ID

COPY package*.json ./
RUN npm install
COPY . .

# Export VITE_ vars so Vite can embed them at build time.
# Priority: build args (from root .env / CI) > frontend/.env
#   1. Save build arg values before sourcing .env (sourcing would overwrite them)
#   2. Source frontend/.env into the shell as the baseline
#   3. Re-apply non-empty build args so they win over .env
RUN set -e; \
    _api="$VITE_API_URL"; \
    _engine="$VITE_ENGINE_URL"; \
    _key="$VITE_ENGINE_API_KEY"; \
    _paypal="$VITE_PAYPAL_CLIENT_ID"; \
    if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
    [ -n "$_api" ]    && export VITE_API_URL="$_api"             || true; \
    [ -n "$_engine" ] && export VITE_ENGINE_URL="$_engine"       || true; \
    [ -n "$_key" ]    && export VITE_ENGINE_API_KEY="$_key"      || true; \
    [ -n "$_paypal" ] && export VITE_PAYPAL_CLIENT_ID="$_paypal" || true; \
    npm run build
# Output is in /app/dist

# ── Stage 2: Serve with nginx ──────────────────────────────────────
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# SPA routing: all paths fall back to index.html
RUN printf 'server {\n\
    listen 3000;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
    # Cache static assets aggressively\n\
    location ~* \\.(?:js|css|woff2|png|svg|ico)$ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
