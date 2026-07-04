#!/bin/bash
# ================================================================
# deploy.sh — Full production deployment for usevoxora.online
# Run as root (or with sudo) from /var/www/voxora
# ================================================================
set -euo pipefail

DOMAIN="usevoxora.online"
EMAIL="csriyarthne@gmail.com"   # ← change to your real email for Let's Encrypt
APP_DIR="/var/www/voxora"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── 0. Sanity checks ──────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Please run as root: sudo bash deploy.sh"
[[ -d "$APP_DIR" ]]     || error "Repo not found at $APP_DIR"
cd "$APP_DIR"

# ── 1. Install Docker + Compose if missing ────────────────────────
if ! command -v docker &>/dev/null; then
    info "Installing Docker..."
    curl -fsSL https://get.docker.com | bash
    systemctl enable docker
    systemctl start docker
fi

if ! docker compose version &>/dev/null; then
    info "Installing Docker Compose plugin..."
    apt-get install -y docker-compose-plugin
fi

# ── 2. Install Certbot if missing ─────────────────────────────────
if ! command -v certbot &>/dev/null; then
    info "Installing Certbot..."
    apt-get update -qq
    apt-get install -y certbot
fi

# ── 3. Copy config files ──────────────────────────────────────────
info "Copying production config files..."

cp .env.example .env
# Set real values
sed -i "s|DB_PASSWORD=.*|DB_PASSWORD=Voxora@Db2025!Strong|"          .env
sed -i "s|MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=Voxora@Root2025!Strong|" .env
sed -i "s|APP_URL=.*|APP_URL=https://${DOMAIN}|"                     .env
sed -i "s|ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://${DOMAIN}|"    .env
sed -i "s|SANCTUM_STATEFUL_DOMAINS=.*|SANCTUM_STATEFUL_DOMAINS=${DOMAIN}|" .env

# Frontend env
cp frontend/.env.example frontend/.env
sed -i "s|VITE_API_URL=.*|VITE_API_URL=https://${DOMAIN}/api|"      frontend/.env
sed -i "s|VITE_ENGINE_URL=.*|VITE_ENGINE_URL=https://${DOMAIN}/ai|" frontend/.env

# Backend env
cp backend/.env.example backend/.env
sed -i "s|APP_ENV=.*|APP_ENV=production|"                            backend/.env
sed -i "s|APP_DEBUG=.*|APP_DEBUG=false|"                             backend/.env
sed -i "s|APP_URL=.*|APP_URL=https://${DOMAIN}|"                     backend/.env
sed -i "s|DB_CONNECTION=.*|DB_CONNECTION=mysql|"                     backend/.env
sed -i "s|# DB_HOST=.*|DB_HOST=db|"                                  backend/.env
sed -i "s|# DB_PORT=.*|DB_PORT=3306|"                                backend/.env
sed -i "s|# DB_DATABASE=.*|DB_DATABASE=voice_saas|"                  backend/.env
sed -i "s|# DB_USERNAME=.*|DB_USERNAME=root|"                        backend/.env
sed -i "s|# DB_PASSWORD=.*|DB_PASSWORD=Voxora@Db2025!Strong|"        backend/.env
# Add missing vars
grep -q "AI_ENGINE_URL" backend/.env || echo "AI_ENGINE_URL=http://ai-engine:8000" >> backend/.env
grep -q "ALLOWED_ORIGINS" backend/.env || echo "ALLOWED_ORIGINS=https://${DOMAIN}" >> backend/.env
grep -q "SANCTUM_STATEFUL_DOMAINS" backend/.env || echo "SANCTUM_STATEFUL_DOMAINS=${DOMAIN}" >> backend/.env
grep -q "SESSION_DOMAIN" backend/.env || echo "SESSION_DOMAIN=${DOMAIN}" >> backend/.env
grep -q "SESSION_SECURE_COOKIE" backend/.env || echo "SESSION_SECURE_COOKIE=true" >> backend/.env
grep -q "SESSION_SAME_SITE" backend/.env || echo "SESSION_SAME_SITE=none" >> backend/.env
grep -q "LOG_LEVEL" backend/.env || echo "LOG_LEVEL=error" >> backend/.env

# ── 4. Generate APP_KEY ───────────────────────────────────────────
info "Generating Laravel APP_KEY..."
APP_KEY=$(docker run --rm php:8.4-cli php -r "echo 'base64:'.base64_encode(random_bytes(32));")
sed -i "s|^APP_KEY=.*|APP_KEY=${APP_KEY}|" backend/.env
info "APP_KEY set."

# ── 5. Obtain SSL cert via Let's Encrypt ──────────────────────────
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
if [[ ! -f "${CERT_DIR}/fullchain.pem" ]]; then
    info "Obtaining Let's Encrypt certificate for ${DOMAIN}..."

    # Make sure port 80 is free (stop any running nginx on host)
    systemctl stop nginx 2>/dev/null || true
    # Stop any existing Docker nginx
    docker compose -f docker-compose.prod.yml down 2>/dev/null || true

    certbot certonly \
        --standalone \
        --non-interactive \
        --agree-tos \
        --email "${EMAIL}" \
        -d "${DOMAIN}" \
        -d "www.${DOMAIN}"

    info "SSL certificate obtained."
else
    info "SSL certificate already exists, skipping."
fi

# ── 6. Install production nginx.conf ─────────────────────────────
info "Installing nginx.conf..."
cat > nginx.conf << 'NGINX'
server {
    listen 80;
    server_name usevoxora.online www.usevoxora.online;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://usevoxora.online$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name usevoxora.online www.usevoxora.online;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "DENY" always;
    add_header X-XSS-Protection          "1; mode=block" always;

    location / {
        proxy_pass         http://frontend:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection $http_connection;
        proxy_set_header   Host       $host;
        proxy_read_timeout 30s;
    }

    location /api/ {
        proxy_pass         http://backend:8080/api/;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 60s;
        client_max_body_size 50M;
    }

    location /sanctum/ {
        proxy_pass         http://backend:8080/sanctum/;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
    }

    location /ai/ {
        proxy_pass            http://ai-engine:8000/;
        proxy_read_timeout    900s;
        proxy_send_timeout    900s;
        proxy_connect_timeout 60s;
        proxy_set_header      Host              $host;
        proxy_set_header      X-Real-IP         $remote_addr;
        proxy_set_header      X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_buffering       off;
        client_max_body_size  100M;
    }
}
NGINX

# ── 7. Install production docker-compose ─────────────────────────
info "Installing docker-compose.prod.yml..."
cat > docker-compose.prod.yml << 'COMPOSE'
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - /etc/letsencrypt/live/usevoxora.online/fullchain.pem:/etc/nginx/certs/fullchain.pem:ro
      - /etc/letsencrypt/live/usevoxora.online/privkey.pem:/etc/nginx/certs/privkey.pem:ro
      - /var/www/certbot:/var/www/certbot:ro
    depends_on:
      - backend
      - frontend
    restart: unless-stopped
    networks:
      - voice-network

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: voice_backend
    env_file:
      - ./backend/.env
    volumes:
      - ./backend:/var/www/html
      - backend_storage:/var/www/html/storage
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - voice-network

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: voice_frontend
    restart: unless-stopped
    networks:
      - voice-network

  ai-engine:
    build:
      context: ./ai-engine
      dockerfile: Dockerfile
    container_name: voice_ai
    volumes:
      - voice_profiles:/app/voice_profiles
      - ai_models:/root/.cache/huggingface
      - tts_models:/root/.local/share/tts
    environment:
      - COQUI_TOS_AGREED=1
      - ALLOWED_ORIGINS=https://usevoxora.online
    command: uvicorn main:app --host 0.0.0.0 --port 8000
    restart: unless-stopped
    networks:
      - voice-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/"]
      interval: 15s
      timeout: 10s
      retries: 10
      start_period: 180s

  db:
    image: mysql:8.0
    container_name: voice_db
    environment:
      MYSQL_DATABASE: voice_saas
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
    volumes:
      - db_data:/var/lib/mysql
    restart: unless-stopped
    networks:
      - voice-network
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h localhost -p$$MYSQL_ROOT_PASSWORD"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 20s

  redis:
    image: redis:alpine
    container_name: voice_redis
    volumes:
      - redis_data:/data
    restart: unless-stopped
    networks:
      - voice-network

networks:
  voice-network:
    driver: bridge

volumes:
  voice_profiles:
  ai_models:
  tts_models:
  db_data:
  redis_data:
  backend_storage:
COMPOSE

# ── 8. Build & start ──────────────────────────────────────────────
info "Building Docker images (this takes a while for the AI engine)..."
docker compose -f docker-compose.prod.yml build

info "Starting all services..."
docker compose -f docker-compose.prod.yml up -d

# ── 9. Wait for DB and run migrations ────────────────────────────
info "Waiting for database to be healthy..."
for i in $(seq 1 30); do
    if docker compose -f docker-compose.prod.yml exec -T db mysqladmin ping \
       -h localhost -p"Voxora@Root2025!Strong" &>/dev/null 2>&1; then
        info "Database is ready."
        break
    fi
    echo "  Attempt $i/30 — waiting 5s..."
    sleep 5
done

info "Running Laravel migrations..."
docker compose -f docker-compose.prod.yml exec -T backend php artisan migrate --force

# ── 10. Setup cert auto-renewal ──────────────────────────────────
info "Setting up automatic certificate renewal..."
CRON_JOB="0 3 * * * certbot renew --quiet --deploy-hook 'docker compose -f ${APP_DIR}/docker-compose.prod.yml exec nginx nginx -s reload'"
(crontab -l 2>/dev/null | grep -v "certbot renew"; echo "$CRON_JOB") | crontab -

# ── 11. Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓  Voxora deployed at https://usevoxora.online${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Useful commands:"
echo "  docker compose -f docker-compose.prod.yml logs -f          # live logs"
echo "  docker compose -f docker-compose.prod.yml logs ai-engine   # AI engine logs"
echo "  docker compose -f docker-compose.prod.yml restart nginx    # reload nginx"
echo "  docker compose -f docker-compose.prod.yml ps               # service status"
echo ""
echo "  NOTE: The AI engine (XTTS/F5-TTS) downloads ~2 GB of models"
echo "  on first synthesis request. This is normal — it caches them."
echo ""
