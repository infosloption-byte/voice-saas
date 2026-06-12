<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminAuditLogController extends Controller
{
    /** GET /admin/audit-log?action=&actor=&from=&to= */
    public function index(Request $request)
    {
        $logs = DB::table('admin_audit_log')
            ->leftJoin('users as actor', 'admin_audit_log.actor_id', '=', 'actor.id')
            ->leftJoin('users as target', 'admin_audit_log.target_user_id', '=', 'target.id')
            ->select(
                'admin_audit_log.*',
                'actor.name as actor_name',
                'actor.email as actor_email',
                'target.name as target_name',
                'target.email as target_email',
            )
            ->when($request->action, fn($q, $a) =>
                $q->where('admin_audit_log.action', 'like', "%{$a}%"))
            ->when($request->actor, fn($q, $a) =>
                $q->where(fn($q) =>
                    $q->where('actor.email', 'like', "%{$a}%")
                      ->orWhere('actor.name', 'like', "%{$a}%")))
            ->when($request->from, fn($q, $d) =>
                $q->whereDate('admin_audit_log.created_at', '>=', $d))
            ->when($request->to, fn($q, $d) =>
                $q->whereDate('admin_audit_log.created_at', '<=', $d))
            ->orderByDesc('admin_audit_log.created_at')
            ->limit(500)
            ->get();

        return response()->json(['logs' => $logs]);
    }
}
