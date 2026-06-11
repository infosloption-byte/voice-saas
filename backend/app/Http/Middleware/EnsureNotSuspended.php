<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Blocks suspended accounts from using any authenticated API route and
 * kills their session. Admins are never blocked (so an accidental
 * self-suspension cannot lock the panel).
 */
class EnsureNotSuspended
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && $user->isSuspended() && !$user->isAdmin()) {
            if ($request->hasSession()) {
                Auth::guard('web')->logout();
                $request->session()->invalidate();
            }

            return response()->json([
                'message' => 'This account has been suspended. Contact support.',
            ], 403);
        }

        return $next($request);
    }
}
