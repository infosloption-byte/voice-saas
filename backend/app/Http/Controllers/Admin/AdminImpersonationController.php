<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

class AdminImpersonationController extends Controller
{
    /**
     * POST /admin/users/{id}/impersonate
     * Replaces the admin's session with the target user, remembering the
     * admin's id so the session can be restored via /impersonation/stop.
     */
    public function start(Request $request, User $user)
    {
        $actor = $request->user();

        if ($actor->id === $user->id) {
            return response()->json(['message' => 'You are already this user.'], 422);
        }
        if ($user->isAdmin()) {
            return response()->json(['message' => 'Admins cannot be impersonated.'], 403);
        }
        if ($user->isSuspended()) {
            return response()->json(['message' => 'Cannot impersonate a suspended user.'], 422);
        }

        DB::table('admin_audit_log')->insert([
            'actor_id'       => $actor->id,
            'target_user_id' => $user->id,
            'action'         => 'user.impersonated',
            'ip'             => $request->ip(),
        ]);
        AuditLog::record('admin.impersonation.start', ['target_email' => $user->email], $actor->id);

        Auth::guard('web')->login($user);
        $request->session()->regenerate();
        $request->session()->put('impersonator_id', $actor->id);

        return response()->json(['user' => $user, 'message' => "Now impersonating {$user->email}."]);
    }

    /**
     * POST /impersonation/stop — restore the original admin session.
     * Deliberately outside the admin middleware: while impersonating, the
     * session user is a regular user and would fail the admin check.
     */
    public function stop(Request $request)
    {
        $adminId = $request->session()->get('impersonator_id');
        if (!$adminId) {
            return response()->json(['message' => 'Not impersonating anyone.'], 422);
        }

        $admin = User::find($adminId);
        if (!$admin || !$admin->isAdmin()) {
            // Original admin gone — just end the session safely
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            return response()->json(['message' => 'Impersonation ended.']);
        }

        AuditLog::record('admin.impersonation.stop', ['was_user' => $request->user()?->email], $admin->id);

        Auth::guard('web')->login($admin);
        $request->session()->regenerate();
        $request->session()->forget('impersonator_id');

        return response()->json(['user' => $admin, 'message' => 'Back to your admin account.']);
    }
}
