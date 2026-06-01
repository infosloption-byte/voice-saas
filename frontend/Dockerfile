# ── Stage 1: Build ─────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Declare build args — used to inject values from CI/CD or a root .env.
# When not passed, the existing frontend/.env is used as-is (see below).
ARG VITE_API_URL
ARG VITE_ENGINE_URL
ARG VITE_ENGINE_API_KEY
ARG VITE_PAYPAL_CLIENT_ID

COPY package*.json ./
RUN npm install
COPY . .

# Write any non-empty build args into .env.local which Vite gives higher
# priority than .env. Leaves .env untouched when args are not supplied,
# so frontend/.env on the server works as the default source of truth.
RUN set -e; \
    for name in VITE_API_URL VITE_ENGINE_URL VITE_ENGINE_API_KEY VITE_PAYPAL_CLIENT_ID; do \
      val=$(eval "printf '%s' \"\${$name}\""); \
      if [ -n "$val" ]; then \
        echo "$name=$val" >> .env.local; \
      fi; \
    done

RUN npm run build
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
