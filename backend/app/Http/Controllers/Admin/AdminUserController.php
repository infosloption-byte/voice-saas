<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AdminUserController extends Controller
{
    /** GET /admin/users — paginated user list with usage stats */
    public function index(Request $request)
    {
        $q = User::query()
            ->select('users.*')
            ->with('subscription')
            ->withCount('projects')
            ->when($request->search, fn($q, $s) =>
                $q->where(fn($q) =>
                    $q->where('name', 'like', "%{$s}%")
                      ->orWhere('email', 'like', "%{$s}%")
                )
            )
            ->when($request->role, fn($q, $r) => $q->where('role', $r))
            ->when($request->plan, fn($q, $p) =>
                $p === 'free'
                    ? $q->whereDoesntHave('subscription', fn($s) => $s->where('status', 'active'))
                    : $q->whereHas('subscription', fn($s) => $s->where('plan', $p)->where('status', 'active'))
            );

        $total = $q->count();

        $users = $q->orderByDesc('created_at')
            ->limit(min((int)($request->limit ?? 50), 200))
            ->offset((int)($request->offset ?? 0))
            ->get()
            ->map(fn($u) => [
                'id'                => $u->id,
                'name'              => $u->name,
                'email'             => $u->email,
                'role'              => $u->role ?? 'user',
                'plan_name'         => $u->plan_name,
                'email_verified_at' => $u->email_verified_at,
                'suspended_at'      => $u->suspended_at,
                'plan_override'     => $u->plan_override,
                'created_at'        => $u->created_at,
                'projects_count'    => $u->projects_count,
            ]);

        return response()->json(['users' => $users, 'total' => $total]);
    }

    /** GET /admin/users/{id} — full user detail */
    public function show(User $user)
    {
        $user->load('subscription', 'voiceProfiles');
        $user->loadCount(['projects', 'voiceProfiles']);

        $synthesisUsed = DB::table('synthesis_usage')
            ->where('user_id', $user->id)
            ->sum('count');

        $translationUsed = DB::table('translation_usage')
            ->where('user_id', $user->id)
            ->sum('count');

        $recentActivity = \App\Models\ActivityLog::where('user_id', $user->id)
            ->orderByDesc('started_at')
            ->limit(20)
            ->get();

        return response()->json([
            'user'             => array_merge($user->toArray(), [
                'role'           => $user->role ?? 'user',
                'synthesis_used' => $synthesisUsed,
                'translation_used' => $translationUsed,
            ]),
            'recent_activity'  => $recentActivity,
        ]);
    }

    /** PUT /admin/users/{id}/role — change role */
    public function updateRole(Request $request, User $user)
    {
        $actor = $request->user();

        // Only super_admin can assign super_admin
        $allowedRoles = $actor->isSuperAdmin()
            ? ['user', 'admin', 'super_admin']
            : ['user', 'admin'];

        $data = $request->validate([
            'role' => ['required', Rule::in($allowedRoles)],
        ]);

        // Prevent super_admin from demoting themselves
        if ($actor->id === $user->id && $data['role'] !== 'super_admin' && $actor->isSuperAdmin()) {
            return response()->json(['message' => 'Super admins cannot demote themselves.'], 422);
        }

        $before = $user->role ?? 'user';
        $user->update(['role' => $data['role']]);

        // Write to admin audit log
        DB::table('admin_audit_log')->insert([
            'actor_id'       => $actor->id,
            'target_user_id' => $user->id,
            'action'         => 'role.changed',
            'before_value'   => $before,
            'after_value'    => $data['role'],
            'ip'             => $request->ip(),
        ]);

        AuditLog::record('admin.role_changed', [
            'target_user' => $user->email,
            'before'      => $before,
            'after'       => $data['role'],
        ], $actor->id);

        return response()->json(['user' => $user->fresh()]);
    }

    /** DELETE /admin/users/{id} — hard delete (super_admin only) */
    public function destroy(Request $request, User $user)
    {
        if (! $request->user()->isSuperAdmin()) {
            return response()->json(['message' => 'Only super admins can delete users.'], 403);
        }

        if ($request->user()->id === $user->id) {
            return response()->json(['message' => 'Cannot delete your own account from admin panel.'], 422);
        }

        $email = $user->email;

        DB::table('admin_audit_log')->insert([
            'actor_id'       => $request->user()->id,
            'target_user_id' => $user->id,
            'action'         => 'user.deleted',
            'before_value'   => $email,
            'ip'             => $request->ip(),
        ]);

        AuditLog::record('admin.user_deleted', ['target_email' => $email], $request->user()->id);
        $user->delete();

        return response()->json(['message' => "User {$email} deleted."]);
    }

    /** POST /admin/users/{id}/suspend — soft, reversible block */
    public function suspend(Request $request, User $user)
    {
        if ($request->user()->id === $user->id) {
            return response()->json(['message' => 'You cannot suspend yourself.'], 422);
        }
        if ($user->isAdmin() && !$request->user()->isSuperAdmin()) {
            return response()->json(['message' => 'Only a super admin can suspend an admin.'], 403);
        }
        if ($user->isSuspended()) {
            return response()->json(['message' => 'User is already suspended.'], 422);
        }

        $user->forceFill(['suspended_at' => now()])->save();

        DB::table('admin_audit_log')->insert([
            'actor_id'       => $request->user()->id,
            'target_user_id' => $user->id,
            'action'         => 'user.suspended',
            'after_value'    => now()->toDateTimeString(),
            'ip'             => $request->ip(),
        ]);
        AuditLog::record('admin.user_suspended', ['target_email' => $user->email], $request->user()->id);

        return response()->json(['user' => $user->fresh()]);
    }

    /** POST /admin/users/{id}/unsuspend */
    public function unsuspend(Request $request, User $user)
    {
        if (!$user->isSuspended()) {
            return response()->json(['message' => 'User is not suspended.'], 422);
        }

        $user->forceFill(['suspended_at' => null])->save();

        DB::table('admin_audit_log')->insert([
            'actor_id'       => $request->user()->id,
            'target_user_id' => $user->id,
            'action'         => 'user.unsuspended',
            'ip'             => $request->ip(),
        ]);
        AuditLog::record('admin.user_unsuspended', ['target_email' => $user->email], $request->user()->id);

        return response()->json(['user' => $user->fresh()]);
    }

    /** POST /admin/users/{id}/send-reset — email a password reset link */
    public function sendPasswordReset(Request $request, User $user)
    {
        $status = \Illuminate\Support\Facades\Password::sendResetLink(['email' => $user->email]);
        if ($status !== \Illuminate\Support\Facades\Password::RESET_LINK_SENT) {
            return response()->json(['message' => 'Could not send reset link (' . __($status) . ')'], 422);
        }

        DB::table('admin_audit_log')->insert([
            'actor_id'       => $request->user()->id,
            'target_user_id' => $user->id,
            'action'         => 'user.reset_link_sent',
            'ip'             => $request->ip(),
        ]);

        return response()->json(['message' => "Password reset link sent to {$user->email}."]);
    }

    /** POST /admin/users/{id}/resend-verification */
    public function resendVerification(Request $request, User $user)
    {
        if ($user->hasVerifiedEmail()) {
            return response()->json(['message' => 'Email is already verified.'], 422);
        }
        $user->sendEmailVerificationNotification();

        DB::table('admin_audit_log')->insert([
            'actor_id'       => $request->user()->id,
            'target_user_id' => $user->id,
            'action'         => 'user.verification_resent',
            'ip'             => $request->ip(),
        ]);

        return response()->json(['message' => "Verification email sent to {$user->email}."]);
    }

    /** PUT /admin/users/{id}/note — free-text admin note */
    public function updateNote(Request $request, User $user)
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:5000']]);
        $user->forceFill(['admin_note' => $data['note'] ?: null])->save();

        DB::table('admin_audit_log')->insert([
            'actor_id'       => $request->user()->id,
            'target_user_id' => $user->id,
            'action'         => 'user.note_updated',
            'ip'             => $request->ip(),
        ]);

        return response()->json(['user' => $user->fresh()]);
    }

    /** PUT /admin/users/{id}/plan — set/clear admin plan override */
    public function updatePlanOverride(Request $request, User $user)
    {
        $data = $request->validate([
            'plan_override' => ['nullable', Rule::in(['starter', 'pro'])],
        ]);

        $before = $user->plan_override;
        $after  = $data['plan_override'] ?? null;
        $user->forceFill(['plan_override' => $after])->save();

        DB::table('admin_audit_log')->insert([
            'actor_id'       => $request->user()->id,
            'target_user_id' => $user->id,
            'action'         => 'user.plan_override',
            'before_value'   => $before ?? 'none',
            'after_value'    => $after ?? 'none',
            'ip'             => $request->ip(),
        ]);
        AuditLog::record('admin.plan_override', [
            'target_email' => $user->email,
            'before'       => $before,
            'after'        => $after,
        ], $request->user()->id);

        return response()->json(['user' => $user->fresh()]);
    }
}
