<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Restrict a route to the admin email defined in ADMIN_EMAIL env var.
 * If the variable is not set, the route is inaccessible to everyone.
 */
class AdminOnly
{
    public function handle(Request $request, Closure $next): Response
    {
        $adminEmail = config('app.admin_email', '');

        if (! $adminEmail || $request->user()?->email !== $adminEmail) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        return $next($request);
    }
}
