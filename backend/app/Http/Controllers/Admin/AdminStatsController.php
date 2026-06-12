<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class AdminStatsController extends Controller
{
    /** Monthly price per plan in USD — mirrors the pricing page. */
    public const PLAN_PRICES = ['starter' => 9.99, 'pro' => 24.99];

    /** GET /admin/stats — platform KPIs */
    public function index()
    {
        $totalUsers    = User::count();
        $verifiedUsers = User::whereNotNull('email_verified_at')->count();
        $todaySignups  = User::whereDate('created_at', today())->count();
        $weekSignups   = User::where('created_at', '>=', now()->subDays(7))->count();

        // Active users by window (had any activity-log entry)
        $activeSince = fn($from) => DB::table('activity_logs')
            ->where('started_at', '>=', $from)
            ->distinct('user_id')->count('user_id');
        $dau = $activeSince(now()->subDay());
        $wau = $activeSince(now()->subDays(7));
        $mau = $activeSince(now()->subDays(30));

        // Active subscribers + revenue
        $starterSubs = DB::table('subscriptions')
            ->where('status', 'active')->where('plan', 'starter')->count();
        $proSubs = DB::table('subscriptions')
            ->where('status', 'active')->where('plan', 'pro')->count();
        $mrr = round($starterSubs * self::PLAN_PRICES['starter'] + $proSubs * self::PLAN_PRICES['pro'], 2);

        $paidUsers = $starterSubs + $proSubs;
        $newSubsMonth = DB::table('subscriptions')
            ->where('created_at', '>=', now()->startOfMonth())->count();
        $churnMonth = DB::table('subscriptions')
            ->where('status', 'cancelled')
            ->where('updated_at', '>=', now()->startOfMonth())->count();

        // Synthesis / translation today — counted from activity logs, since
        // usage tables bucket by day OR month depending on the user's plan
        $synthToday = DB::table('activity_logs')
            ->where('event_type', 'synthesis')
            ->where('started_at', '>=', today())
            ->count();
        $transToday = DB::table('activity_logs')
            ->where('event_type', 'translation')
            ->where('started_at', '>=', today())
            ->count();

        // Jobs in last 24h: volume, failures, durations
        $jobsToday = DB::table('activity_logs')
            ->where('started_at', '>=', now()->subDay())->count();
        $jobsFailed = DB::table('activity_logs')
            ->where('started_at', '>=', now()->subDay())
            ->where('status', 'failed')->count();
        $failureRate = $jobsToday > 0 ? round($jobsFailed / $jobsToday * 100, 1) : 0.0;

        $durations = DB::table('activity_logs')
            ->where('started_at', '>=', now()->subDay())
            ->whereNotNull('ended_at')
            ->selectRaw('TIMESTAMPDIFF(SECOND, started_at, ended_at) as secs')
            ->pluck('secs')->map(fn($s) => max((int) $s, 0))->sort()->values();
        $avgDuration = $durations->isNotEmpty() ? round($durations->avg(), 1) : 0;
        $p95Duration = $durations->isNotEmpty()
            ? $durations[(int) floor(($durations->count() - 1) * 0.95)]
            : 0;

        // Words synthesized + engine split — parsed from the structured
        // detail field ("model:F5-TTS|words:123|voice:Name")
        $parseWindow = fn($from) => DB::table('activity_logs')
            ->where('event_type', 'synthesis')
            ->where('started_at', '>=', $from)
            ->whereNotNull('detail')
            ->pluck('detail');
        [$wordsToday, ] = $this->parseDetails($parseWindow(today()));
        [$wordsWeek, $engineSplit] = $this->parseDetails($parseWindow(now()->subDays(7)));

        // Voice clones this week
        $clonesWeek = DB::table('activity_logs')
            ->where('event_type', 'voice_clone')
            ->where('started_at', '>=', now()->subDays(7))
            ->count();

        // Top translation language pairs (30d), parsed from "langs:EN → ES"
        $langPairs = [];
        foreach (DB::table('activity_logs')
            ->where('event_type', 'translation')
            ->where('started_at', '>=', now()->subDays(30))
            ->whereNotNull('detail')->pluck('detail') as $detail) {
            if (preg_match('/(?:^|\|)langs:([^|]+)/', $detail, $m)) {
                $pair = trim($m[1]);
                $langPairs[$pair] = ($langPairs[$pair] ?? 0) + 1;
            }
        }
        arsort($langPairs);
        $langPairs = array_slice($langPairs, 0, 5, true);

        // Retention: users who signed up 8-37 days ago and were active in
        // the last 7 days
        $cohort = DB::table('users')
            ->whereBetween('created_at', [now()->subDays(37), now()->subDays(8)])
            ->pluck('id');
        $retained = $cohort->isEmpty() ? 0 : DB::table('activity_logs')
            ->whereIn('user_id', $cohort)
            ->where('started_at', '>=', now()->subDays(7))
            ->distinct('user_id')->count('user_id');
        $retention = $cohort->isEmpty() ? null : round($retained / $cohort->count() * 100, 1);

        // System health
        $queuePending = $this->tableCount('jobs');
        $queueFailed  = $this->tableCount('failed_jobs');
        $activeEngine = DB::table('engine_configs')->where('is_active', true)
            ->select('name', 'url', 'status', 'latency_ms', 'last_tested_at')->first();

        // Disk usage of the storage volume
        $diskTotal = @disk_total_space(storage_path());
        $diskFree  = @disk_free_space(storage_path());
        $diskUsedPct = ($diskTotal && $diskFree !== false)
            ? round(($diskTotal - $diskFree) / $diskTotal * 100, 1)
            : null;

        // Database size (MySQL)
        $dbSizeMb = null;
        try {
            $row = DB::selectOne(
                'SELECT ROUND(SUM(data_length + index_length) / 1048576, 1) AS mb
                 FROM information_schema.tables WHERE table_schema = DATABASE()'
            );
            $dbSizeMb = $row->mb !== null ? (float) $row->mb : null;
        } catch (\Throwable) {
            // non-MySQL or no permission — omit
        }

        // Most recent .sql.gz backup (same dir backup:check watches)
        $lastBackup = null;
        $backupDir  = env('BACKUP_DIR', '/home/user/voice-saas/backups');
        if (is_dir($backupDir)) {
            $newest = 0;
            foreach (glob($backupDir . '/*.sql.gz') ?: [] as $file) {
                $newest = max($newest, filemtime($file));
            }
            if ($newest > 0) $lastBackup = date('c', $newest);
        }

        // User growth chart: last 30 days signups per day
        $growthRaw = DB::table('users')
            ->select(DB::raw('DATE(created_at) as day'), DB::raw('COUNT(*) as count'))
            ->where('created_at', '>=', now()->subDays(30))
            ->groupBy('day')->orderBy('day')->get()->keyBy('day');
        $growth = [];
        for ($i = 29; $i >= 0; $i--) {
            $day = now()->subDays($i)->toDateString();
            $growth[] = ['day' => $day, 'count' => $growthRaw[$day]->count ?? 0];
        }

        // Synthesis chart: last 7 days (day buckets)
        $synthChart = DB::table('synthesis_usage')
            ->select('period_key as day', DB::raw('SUM(count) as total'))
            ->where('period_type', 'day')
            ->where('period_key', '>=', now()->subDays(6)->toDateString())
            ->groupBy('period_key')->orderBy('period_key')->get()->keyBy('day');
        $synthTrend = [];
        for ($i = 6; $i >= 0; $i--) {
            $day = now()->subDays($i)->toDateString();
            $synthTrend[] = ['day' => $day, 'count' => (int) ($synthChart[$day]->total ?? 0)];
        }

        // Failure chart: failed jobs per day, last 14 days
        $jobsByDay = DB::table('activity_logs')
            ->selectRaw("DATE(started_at) as day, COUNT(*) as total, SUM(status = 'failed') as failed")
            ->where('started_at', '>=', now()->subDays(14))
            ->groupBy('day')->orderBy('day')->get()->keyBy('day');
        $failTrend = [];
        for ($i = 13; $i >= 0; $i--) {
            $day = now()->subDays($i)->toDateString();
            $row = $jobsByDay[$day] ?? null;
            $failTrend[] = ['day' => $day, 'count' => (int) ($row->failed ?? 0), 'total' => (int) ($row->total ?? 0)];
        }

        return response()->json([
            'users' => [
                'total'      => $totalUsers,
                'verified'   => $verifiedUsers,
                'unverified' => $totalUsers - $verifiedUsers,
                'today'      => $todaySignups,
                'week'       => $weekSignups,
                'dau'        => $dau,
                'wau'        => $wau,
                'mau'        => $mau,
                'stickiness' => $mau > 0 ? round($dau / $mau * 100, 1) : 0.0,
                'retention'  => $retention,
            ],
            'revenue' => [
                'mrr'             => $mrr,
                'paid_users'      => $paidUsers,
                'conversion_rate' => $totalUsers > 0 ? round($paidUsers / $totalUsers * 100, 1) : 0.0,
                'new_subs_month'  => $newSubsMonth,
                'churn_month'     => $churnMonth,
            ],
            'subscriptions' => [
                'starter' => $starterSubs,
                'pro'     => $proSubs,
                'free'    => $totalUsers - $paidUsers,
            ],
            'activity' => [
                'synthesis_today'   => (int) $synthToday,
                'translation_today' => (int) $transToday,
                'jobs_today'        => $jobsToday,
                'jobs_failed_today' => $jobsFailed,
                'failure_rate'      => $failureRate,
                'avg_duration_s'    => $avgDuration,
                'p95_duration_s'    => $p95Duration,
                'words_today'       => $wordsToday,
                'words_week'        => $wordsWeek,
                'engine_split'      => $engineSplit,
                'clones_week'       => $clonesWeek,
                'lang_pairs'        => $langPairs,
            ],
            'system' => [
                'queue_pending' => $queuePending,
                'queue_failed'  => $queueFailed,
                'active_engine' => $activeEngine,
                'disk_used_pct' => $diskUsedPct,
                'db_size_mb'    => $dbSizeMb,
                'last_backup'   => $lastBackup,
            ],
            'charts' => [
                'user_growth' => $growth,
                'synth_trend' => $synthTrend,
                'fail_trend'  => $failTrend,
            ],
        ]);
    }

    /**
     * Parse pipe-delimited "key:value" detail strings.
     * Returns [total words, model split counts].
     */
    private function parseDetails($details): array
    {
        $words = 0;
        $split = [];
        foreach ($details as $detail) {
            foreach (explode('|', $detail) as $pair) {
                [$k, $v] = array_pad(explode(':', $pair, 2), 2, null);
                if ($k === 'words' && is_numeric($v)) $words += (int) $v;
                if ($k === 'model' && $v !== null)    $split[$v] = ($split[$v] ?? 0) + 1;
            }
        }
        return [$words, $split];
    }

    private function tableCount(string $table): int
    {
        try {
            return DB::table($table)->count();
        } catch (\Throwable) {
            return 0;
        }
    }
}
