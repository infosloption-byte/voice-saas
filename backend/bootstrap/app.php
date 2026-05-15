<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // ADD THIS — trust nginx as a reverse proxy
        $middleware->trustProxies(
            at: '*',
            headers: Request::HEADER_X_FORWARDED_FOR |
                     Request::HEADER_X_FORWARDED_HOST |
                     Request::HEADER_X_FORWARDED_PORT |
                     Request::HEADER_X_FORWARDED_PROTO
        );
        // ← ADD THIS: ensures CORS headers are on EVERY response,
        //   including redirects that fire before the api group middleware
        $middleware->prepend(\Illuminate\Http\Middleware\HandleCors::class);

        $middleware->statefulApi();

        $middleware->trustHosts([
            'localhost',
            '127.0.0.1',
            '::1',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();