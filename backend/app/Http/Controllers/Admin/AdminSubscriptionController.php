<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminSubscriptionController extends Controller
{
    /** GET /admin/subscriptions */
    public function index(Request $request)
    {
        $q = DB::table('subscriptions')
            ->join('users', 'subscriptions.user_id', '=', 'users.id')
            ->select(
                'subscriptions.*',
                'users.name as user_name',
                'users.email as user_email',
            )
            ->when($request->status, fn($q, $s) => $q->where('subscriptions.status', $s))
            ->when($request->plan,   fn($q, $p) => $q->where('subscriptions.plan', $p))
            ->orderByDesc('subscriptions.created_at');

        $total = $q->count();
        $subs  = $q->limit(200)->get();

        return response()->json(['subscriptions' => $subs, 'total' => $total]);
    }

    /** POST /admin/subscriptions/{id}/cancel — admin-forced cancellation */
    public function cancel(Request $request, int $id)
    {
        $sub = DB::table('subscriptions')->where('id', $id)->first();
        if (! $sub) return response()->json(['message' => 'Not found.'], 404);

        DB::table('subscriptions')->where('id', $id)->update(['status' => 'cancelled']);

        DB::table('admin_audit_log')->insert([
            'actor_id'       => $request->user()->id,
            'target_user_id' => $sub->user_id,
            'action'         => 'subscription.admin_cancelled',
            'before_value'   => $sub->status,
            'after_value'    => 'cancelled',
            'ip'             => $request->ip(),
        ]);

        AuditLog::record('admin.subscription_cancelled', [
            'subscription_id' => $id,
            'plan'            => $sub->plan,
        ], $request->user()->id);

        return response()->json(['message' => 'Subscription cancelled.']);
    }
}
