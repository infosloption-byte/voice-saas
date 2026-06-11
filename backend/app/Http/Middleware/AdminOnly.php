<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Restrict a route to users with role admin or super_admin.
 * Falls back to ADMIN_EMAIL check so existing deployments keep working
 * before the migration has run.
 */
class AdminOnly
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        // Role-based check (post-migration)
        if ($user->isAdmin()) {
            return $next($request);
        }

        // Legacy fallback: ADMIN_EMAIL env still works if role column isn't set yet
        $adminEmail = config('app.admin_email', '');
        if ($adminEmail && $user->email === $adminEmail) {
            return $next($request);
        }

        return response()->json(['message' => 'Forbidden.'], 403);
    }
}
