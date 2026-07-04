FROM php:8.4-fpm

RUN apt-get update && apt-get install -y \
    git curl libpng-dev libonig-dev libxml2-dev zip unzip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-install pdo_mysql mbstring exif pcntl bcmath gd

# phpredis — required for the Redis cache/queue drivers and the health probe.
# $PHPIZE_DEPS (autoconf/gcc/make) is needed to compile the PECL extension;
# remove it afterwards to keep the image small.
RUN apt-get update \
    && apt-get install -y --no-install-recommends $PHPIZE_DEPS \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apt-get purge -y --auto-remove $PHPIZE_DEPS \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

RUN { \
    echo "upload_max_filesize=64M"; \
    echo "post_max_size=200M"; \
    echo "max_file_uploads=20"; \
} > /usr/local/etc/php/conf.d/uploads.ini

WORKDIR /var/www/html

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["docker-entrypoint.sh"]