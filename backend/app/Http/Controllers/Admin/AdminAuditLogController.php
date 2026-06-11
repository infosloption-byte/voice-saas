<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\DB;

class AdminAuditLogController extends Controller
{
    /** GET /admin/audit-log */
    public function index()
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
            ->orderByDesc('admin_audit_log.created_at')
            ->limit(500)
            ->get();

        return response()->json(['logs' => $logs]);
    }
}
