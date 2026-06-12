<?php

namespace App\Console\Commands;

use App\Http\Controllers\Admin\AdminStatsController;
use App\Mail\AdminDigestMail;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

class SendAdminDigest extends Command
{
    protected $signature   = 'admin:digest';
    protected $description = 'Email yesterday\'s KPI digest to all admins';

    public function handle(): int
    {
        $from = now()->subDay()->startOfDay();
        $to   = now()->startOfDay();

        $jobs = DB::table('activity_logs')
            ->whereBetween('started_at', [$from, $to])
            ->selectRaw("COUNT(*) as total, SUM(status = 'failed') as failed")
            ->first();

        $words = 0;
        foreach (DB::table('activity_logs')
            ->where('event_type', 'synthesis')
            ->whereBetween('started_at', [$from, $to])
            ->whereNotNull('detail')->pluck('detail') as $detail) {
            if (preg_match('/(?:^|\|)words:(\d+)/', $detail, $m)) $words += (int) $m[1];
        }

        $prices  = AdminStatsController::PLAN_PRICES;
        $starter = DB::table('subscriptions')->where('status', 'active')->where('plan', 'starter')->count();
        $pro     = DB::table('subscriptions')->where('status', 'active')->where('plan', 'pro')->count();

        $stats = [
            'date'          => $from->toFormattedDateString(),
            'signups'       => DB::table('users')->whereBetween('created_at', [$from, $to])->count(),
            'active_users'  => DB::table('activity_logs')->whereBetween('started_at', [$from, $to])
                                   ->distinct('user_id')->count('user_id'),
            'jobs'          => (int) ($jobs->total ?? 0),
            'failed'        => (int) ($jobs->failed ?? 0),
            'words'         => $words,
            'new_subs'      => DB::table('subscriptions')->whereBetween('created_at', [$from, $to])->count(),
            'cancellations' => DB::table('subscriptions')->where('status', 'cancelled')
                                   ->whereBetween('updated_at', [$from, $to])->count(),
            'mrr'           => round($starter * $prices['starter'] + $pro * $prices['pro'], 2),
        ];

        $admins = User::whereIn('role', ['admin', 'super_admin'])->get();
        foreach ($admins as $admin) {
            Mail::to($admin->email)->queue(new AdminDigestMail($stats));
        }

        $this->info("Digest queued to {$admins->count()} admin(s).");
        return self::SUCCESS;
    }
}
