#!/bin/sh
set -e

cd /var/www/html

# Install PHP dependencies if missing
if [ ! -f "vendor/autoload.php" ]; then
    echo "Running composer install..."
    composer install --ignore-platform-reqs --no-dev --optimize-autoloader
fi

# Force correct DB host (overrides any stale .env value)
sed -i 's/DB_HOST=127.0.0.1/DB_HOST=db/' .env 2>/dev/null || true
sed -i 's/DB_HOST=localhost/DB_HOST=db/' .env 2>/dev/null || true

# Generate app key only if not already set
if grep -q '^APP_KEY=$' .env 2>/dev/null || ! grep -q '^APP_KEY=' .env 2>/dev/null; then
    php artisan key:generate --no-interaction
fi

# Run migrations
echo "Waiting for database..."
for i in $(seq 1 30); do
    php artisan migrate --force && break
    echo "Attempt $i failed, retrying in 3s..."
    sleep 3
done


# Start the dev server
exec php artisan serve --host=0.0.0.0 --port=8080