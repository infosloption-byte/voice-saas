#!/bin/sh
set -e

cd /var/www/html

# Install PHP dependencies if missing
if [ ! -f "vendor/autoload.php" ]; then
    echo "Running composer install..."
    composer install --ignore-platform-reqs --no-dev --optimize-autoloader
fi

# Generate app key if APP_KEY is empty
php artisan key:generate --force

# Run migrations
echo "Waiting for database..."
for i in $(seq 1 30); do
    php artisan migrate --force && break
    echo "Attempt $i failed, retrying in 3s..."
    sleep 3
done


# Start the dev server
exec php artisan serve --host=0.0.0.0 --port=8080