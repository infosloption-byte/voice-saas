<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminReportsController extends Controller
{
    /**
     * GET /admin/reports/top-users?days=30&limit=50&format=csv
     * Users ranked by synthesis volume over the window.
     */
    public function topUsers(Request $request)
    {
        $days  = min(max((int) $request->input('days', 30), 1), 365);
        $limit = min(max((int) $request->input('limit', 50), 1), 200);
        $from  = now()->subDays($days);

        $counts = DB::table('activity_logs')
            ->selectRaw("user_id, COUNT(*) as jobs, SUM(status = 'failed') as failed")
            ->where('event_type', 'synthesis')
            ->where('started_at', '>=', $from)
            ->groupBy('user_id')
            ->orderByDesc('jobs')
            ->limit($limit)
            ->get();

        $userIds = $counts->pluck('user_id');

        // Words per user, parsed from the structured detail field
        $words = [];
        DB::table('activity_logs')
            ->select('user_id', 'detail')
            ->where('event_type', 'synthesis')
            ->where('started_at', '>=', $from)
            ->whereIn('user_id', $userIds)
            ->whereNotNull('detail')
            ->orderBy('id')
            ->chunk(2000, function ($chunk) use (&$words) {
                foreach ($chunk as $row) {
                    if (preg_match('/(?:^|\|)words:(\d+)/', $row->detail, $m)) {
                        $words[$row->user_id] = ($words[$row->user_id] ?? 0) + (int) $m[1];
                    }
                }
            });

        $users = DB::table('users')
            ->leftJoin('subscriptions', function ($j) {
                $j->on('subscriptions.user_id', '=', 'users.id')
                  ->where('subscriptions.status', 'active');
            })
            ->whereIn('users.id', $userIds)
            ->select('users.id', 'users.name', 'users.email', 'subscriptions.plan')
            ->get()->keyBy('id');

        $rows = $counts->map(fn($c) => [
            'user_id' => $c->user_id,
            'name'    => $users[$c->user_id]->name ?? '(deleted)',
            'email'   => $users[$c->user_id]->email ?? '—',
            'plan'    => $users[$c->user_id]->plan ?? 'free',
            'jobs'    => (int) $c->jobs,
            'failed'  => (int) $c->failed,
            'words'   => $words[$c->user_id] ?? 0,
        ])->values();

        if ($request->input('format') === 'csv') {
            return $this->csv($rows->toArray(), "top-users-{$days}d.csv");
        }
        return response()->json(['days' => $days, 'rows' => $rows]);
    }

    /**
     * GET /admin/reports/quota-pressure?threshold=80
     * Users at or above N% of their synthesis quota for the current period.
     */
    public function quotaPressure(Request $request)
    {
        $threshold = min(max((int) $request->input('threshold', 80), 1), 100);

        $plans = DB::table('plan_limits')->get()->keyBy('plan');

        $rows = [];
        DB::table('users')
            ->leftJoin('subscriptions', function ($j) {
                $j->on('subscriptions.user_id', '=', 'users.id')
                  ->where('subscriptions.status', 'active');
            })
            ->select('users.id', 'users.name', 'users.email', 'subscriptions.plan')
            ->orderBy('users.id')
            ->chunk(500, function ($chunk) use (&$rows, $plans, $threshold) {
                foreach ($chunk as $u) {
                    $plan   = $u->plan ?? 'free';
                    $limits = $plans[$plan] ?? null;
                    $limit  = (int) ($limits->synth_limit ?? 0);
                    if ($limit <= 0) continue; // 0 = unlimited

                    $periodType = $limits->synth_period ?? 'day';
                    $periodKey  = $periodType === 'month'
                        ? now()->format('Y-m')
                        : now()->toDateString();

                    $used = (int) DB::table('synthesis_usage')
                        ->where('user_id', $u->id)
                        ->where('period_type', $periodType)
                        ->where('period_key', $periodKey)
                        ->value('count');

                    $pct = round($used / $limit * 100, 1);
                    if ($pct >= $threshold) {
                        $rows[] = [
                            'user_id' => $u->id,
                            'name'    => $u->name,
                            'email'   => $u->email,
                            'plan'    => $plan,
                            'period'  => $periodType,
                            'used'    => $used,
                            'limit'   => $limit,
                            'percent' => $pct,
                        ];
                    }
                }
            });

        usort($rows, fn($a, $b) => $b['percent'] <=> $a['percent']);

        if ($request->input('format') === 'csv') {
            return $this->csv($rows, 'quota-pressure.csv');
        }
        return response()->json(['threshold' => $threshold, 'rows' => $rows]);
    }

    /**
     * GET /admin/reports/revenue?months=12
     * Monthly new subs, cancellations and estimated MRR per plan.
     */
    public function revenue(Request $request)
    {
        $months = min(max((int) $request->input('months', 12), 1), 36);
        $prices = AdminStatsController::PLAN_PRICES;

        $rows = [];
        for ($i = $months - 1; $i >= 0; $i--) {
            $start = now()->subMonths($i)->startOfMonth();
            $end   = now()->subMonths($i)->endOfMonth();

            $newSubs = DB::table('subscriptions')
                ->whereBetween('created_at', [$start, $end])
                ->selectRaw("plan, COUNT(*) as c")->groupBy('plan')->pluck('c', 'plan');
            $cancelled = DB::table('subscriptions')
                ->where('status', 'cancelled')
                ->whereBetween('updated_at', [$start, $end])
                ->count();

            // Subs active at month end: created before end and not cancelled before end
            $mrr = 0;
            foreach ($prices as $plan => $price) {
                $active = DB::table('subscriptions')
                    ->where('plan', $plan)
                    ->where('created_at', '<=', $end)
                    ->where(fn($q) => $q->where('status', 'active')
                        ->orWhere('updated_at', '>', $end))
                    ->count();
                $mrr += $active * $price;
            }

            $rows[] = [
                'month'       => $start->format('Y-m'),
                'new_starter' => (int) ($newSubs['starter'] ?? 0),
                'new_pro'     => (int) ($newSubs['pro'] ?? 0),
                'cancelled'   => $cancelled,
                'mrr'         => round($mrr, 2),
            ];
        }

        if ($request->input('format') === 'csv') {
            return $this->csv($rows, 'revenue.csv');
        }
        return response()->json(['rows' => $rows]);
    }

    /**
     * GET /admin/reports/funnel
     * Signup → verified → first project → first synthesis → paid.
     */
    public function funnel()
    {
        $total    = DB::table('users')->count();
        $verified = DB::table('users')->whereNotNull('email_verified_at')->count();
        $withProject = DB::table('users')
            ->whereExists(fn($q) => $q->selectRaw(1)->from('projects')
                ->whereColumn('projects.user_id', 'users.id'))
            ->count();
        $withSynthesis = DB::table('activity_logs')
            ->where('event_type', 'synthesis')
            ->distinct('user_id')->count('user_id');
        $paid = DB::table('subscriptions')->where('status', 'active')
            ->distinct('user_id')->count('user_id');

        $pct = fn($n) => $total > 0 ? round($n / $total * 100, 1) : 0.0;

        return response()->json(['steps' => [
            ['step' => 'Signed up',       'count' => $total,         'percent' => 100.0],
            ['step' => 'Verified email',  'count' => $verified,      'percent' => $pct($verified)],
            ['step' => 'Created project', 'count' => $withProject,   'percent' => $pct($withProject)],
            ['step' => 'First synthesis', 'count' => $withSynthesis, 'percent' => $pct($withSynthesis)],
            ['step' => 'Paid plan',       'count' => $paid,          'percent' => $pct($paid)],
        ]]);
    }

    /**
     * GET /admin/reports/engines?days=14
     * Per TTS model per day: jobs, failures, avg duration.
     */
    public function engines(Request $request)
    {
        $days = min(max((int) $request->input('days', 14), 1), 90);

        $agg = [];
        DB::table('activity_logs')
            ->select('started_at', 'ended_at', 'status', 'detail')
            ->where('event_type', 'synthesis')
            ->where('started_at', '>=', now()->subDays($days))
            ->orderBy('id')
            ->chunk(2000, function ($chunk) use (&$agg) {
                foreach ($chunk as $row) {
                    $model = 'unknown';
                    if ($row->detail && preg_match('/(?:^|\|)model:([^|]+)/', $row->detail, $m)) {
                        $model = $m[1];
                    }
                    $day = substr($row->started_at, 0, 10);
                    $key = "$day|$model";
                    $agg[$key] ??= ['day' => $day, 'model' => $model, 'jobs' => 0, 'failed' => 0, 'secs' => 0, 'done' => 0];
                    $agg[$key]['jobs']++;
                    if ($row->status === 'failed') $agg[$key]['failed']++;
                    if ($row->ended_at) {
                        $agg[$key]['secs'] += max(strtotime($row->ended_at) - strtotime($row->started_at), 0);
                        $agg[$key]['done']++;
                    }
                }
            });

        $rows = array_values(array_map(fn($a) => [
            'day'          => $a['day'],
            'model'        => $a['model'],
            'jobs'         => $a['jobs'],
            'failed'       => $a['failed'],
            'failure_rate' => $a['jobs'] > 0 ? round($a['failed'] / $a['jobs'] * 100, 1) : 0.0,
            'avg_secs'     => $a['done'] > 0 ? round($a['secs'] / $a['done'], 1) : 0,
        ], $agg));
        usort($rows, fn($a, $b) => [$b['day'], $a['model']] <=> [$a['day'], $b['model']]);

        if ($request->input('format') === 'csv') {
            return $this->csv($rows, "engine-performance-{$days}d.csv");
        }
        return response()->json(['days' => $days, 'rows' => $rows]);
    }

    /**
     * GET /admin/reports/trends?days=30
     * Daily time-series for charting: signups, active users, jobs,
     * failures, words synthesized, translations.
     */
    public function trends(Request $request)
    {
        $days = min(max((int) $request->input('days', 30), 7), 90);
        $from = now()->subDays($days - 1)->startOfDay();

        $signups = DB::table('users')
            ->selectRaw('DATE(created_at) as day, COUNT(*) as c')
            ->where('created_at', '>=', $from)
            ->groupBy('day')->pluck('c', 'day');

        $active = DB::table('activity_logs')
            ->selectRaw('DATE(started_at) as day, COUNT(DISTINCT user_id) as c')
            ->where('started_at', '>=', $from)
            ->groupBy('day')->pluck('c', 'day');

        $jobs = DB::table('activity_logs')
            ->selectRaw("DATE(started_at) as day, COUNT(*) as total,
                         SUM(status = 'failed') as failed,
                         SUM(event_type = 'translation') as translations")
            ->where('started_at', '>=', $from)
            ->groupBy('day')->get()->keyBy('day');

        // Words per day from the structured detail field
        $words = [];
        DB::table('activity_logs')
            ->select('started_at', 'detail')
            ->where('event_type', 'synthesis')
            ->where('started_at', '>=', $from)
            ->whereNotNull('detail')
            ->orderBy('id')
            ->chunk(2000, function ($chunk) use (&$words) {
                foreach ($chunk as $row) {
                    if (preg_match('/(?:^|\|)words:(\d+)/', $row->detail, $m)) {
                        $day = substr($row->started_at, 0, 10);
                        $words[$day] = ($words[$day] ?? 0) + (int) $m[1];
                    }
                }
            });

        $rows = [];
        for ($i = $days - 1; $i >= 0; $i--) {
            $day = now()->subDays($i)->toDateString();
            $j   = $jobs[$day] ?? null;
            $rows[] = [
                'day'          => $day,
                'signups'      => (int) ($signups[$day] ?? 0),
                'active_users' => (int) ($active[$day] ?? 0),
                'jobs'         => (int) ($j->total ?? 0),
                'failed'       => (int) ($j->failed ?? 0),
                'translations' => (int) ($j->translations ?? 0),
                'words'        => (int) ($words[$day] ?? 0),
            ];
        }

        if ($request->input('format') === 'csv') {
            return $this->csv($rows, "trends-{$days}d.csv");
        }
        return response()->json(['days' => $days, 'rows' => $rows]);
    }

    /**
     * GET /admin/reports/export/users — full user list as CSV.
     */
    public function exportUsers()
    {
        $rows = DB::table('users')
            ->leftJoin('subscriptions', function ($j) {
                $j->on('subscriptions.user_id', '=', 'users.id')
                  ->where('subscriptions.status', 'active');
            })
            ->select(
                'users.id', 'users.name', 'users.email', 'users.role',
                DB::raw("COALESCE(subscriptions.plan, 'free') as plan"),
                'users.email_verified_at', 'users.created_at'
            )
            ->orderBy('users.id')
            ->get()
            ->map(fn($r) => (array) $r)
            ->toArray();

        return $this->csv($rows, 'users.csv');
    }

    /** Render rows (array of assoc arrays) as a CSV download. */
    private function csv(array $rows, string $filename)
    {
        $out = fopen('php://temp', 'r+');
        if (!empty($rows)) {
            fputcsv($out, array_keys($rows[0]));
            foreach ($rows as $row) fputcsv($out, array_values($row));
        }
        rewind($out);
        $body = stream_get_contents($out);
        fclose($out);

        return response($body, 200, [
            'Content-Type'        => 'text/csv; charset=utf-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }
}
