#!/bin/sh
set -e

cd /var/www/html

# Install PHP dependencies if missing
if [ ! -f "vendor/autoload.php" ]; then
    echo "Running composer install..."
    composer install --no-dev --optimize-autoloader
fi

# Generate app key if APP_KEY is empty
php artisan key:generate --force

# Run migrations
php artisan migrate --force

# Start the dev server
exec php artisan serve --host=0.0.0.0 --port=8080