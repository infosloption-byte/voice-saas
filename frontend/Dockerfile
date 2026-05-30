# ── Stage 1: Build ─────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Accept build-time env vars — VITE_ variables are baked into the JS bundle
ARG VITE_API_URL
ARG VITE_ENGINE_URL
ARG VITE_ENGINE_API_KEY
ARG VITE_PAYPAL_CLIENT_ID

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_ENGINE_URL=$VITE_ENGINE_URL
ENV VITE_ENGINE_API_KEY=$VITE_ENGINE_API_KEY
ENV VITE_PAYPAL_CLIENT_ID=$VITE_PAYPAL_CLIENT_ID

COPY package*.json ./
RUN npm install
COPY . .
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
