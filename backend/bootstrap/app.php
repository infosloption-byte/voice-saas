<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Trust nginx as a reverse proxy
        $middleware->trustProxies(
            at: '*',
            headers: Request::HEADER_X_FORWARDED_FOR |
                     Request::HEADER_X_FORWARDED_HOST |
                     Request::HEADER_X_FORWARDED_PORT |
                     Request::HEADER_X_FORWARDED_PROTO
        );

        // Ensures CORS headers are on EVERY response, including redirects
        $middleware->prepend(\Illuminate\Http\Middleware\HandleCors::class);

        // Security headers (X-Frame-Options, CSP, HSTS, etc.) on every response
        $middleware->append(\App\Http\Middleware\SecurityHeaders::class);

        $middleware->statefulApi();

        $middleware->trustHosts(array_filter([
            'localhost',
            '127.0.0.1',
            '::1',
            env('APP_DOMAIN'),   // set APP_DOMAIN=yourdomain.com in production
        ]));
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();