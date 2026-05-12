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
        // Enable Sanctum stateful API (SPA cookie auth)
        $middleware->statefulApi();

        // Trust localhost regardless of port so cookies work in dev
        $middleware->trustHosts([
            'localhost',
            '127.0.0.1',
            '::1',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();