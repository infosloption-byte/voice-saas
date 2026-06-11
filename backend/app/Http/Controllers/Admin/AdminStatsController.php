<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class AdminStatsController extends Controller
{
    /** GET /admin/stats — platform KPIs */
    public function index()
    {
        $totalUsers   = User::count();
        $verifiedUsers = User::whereNotNull('email_verified_at')->count();
        $todaySignups  = User::whereDate('created_at', today())->count();
        $weekSignups   = User::where('created_at', '>=', now()->subDays(7))->count();

        // Active subscribers
        $starterSubs = DB::table('subscriptions')
            ->where('status', 'active')->where('plan', 'starter')->count();
        $proSubs = DB::table('subscriptions')
            ->where('status', 'active')->where('plan', 'pro')->count();

        // Synthesis today
        $synthToday = DB::table('synthesis_usage')
            ->where('period', today()->toDateString())
            ->sum('count');

        // Translation today
        $transToday = DB::table('translation_usage')
            ->where('period', today()->toDateString())
            ->sum('count');

        // Jobs in last 24h
        $jobsToday  = DB::table('activity_logs')
            ->where('started_at', '>=', now()->subDay())
            ->count();
        $jobsFailed = DB::table('activity_logs')
            ->where('started_at', '>=', now()->subDay())
            ->where('status', 'failed')
            ->count();

        // Daily active users (had an activity log entry in last 24h)
        $dau = DB::table('activity_logs')
            ->where('started_at', '>=', now()->subDay())
            ->distinct('user_id')
            ->count('user_id');

        // User growth chart: last 30 days signups per day
        $growthRaw = DB::table('users')
            ->select(DB::raw('DATE(created_at) as day'), DB::raw('COUNT(*) as count'))
            ->where('created_at', '>=', now()->subDays(30))
            ->groupBy('day')
            ->orderBy('day')
            ->get()
            ->keyBy('day');

        $growth = [];
        for ($i = 29; $i >= 0; $i--) {
            $day = now()->subDays($i)->toDateString();
            $growth[] = ['day' => $day, 'count' => $growthRaw[$day]->count ?? 0];
        }

        // Synthesis chart: last 7 days
        $synthChart = DB::table('synthesis_usage')
            ->select('period as day', DB::raw('SUM(count) as total'))
            ->where('period', '>=', now()->subDays(6)->toDateString())
            ->groupBy('period')
            ->orderBy('period')
            ->get()
            ->keyBy('day');

        $synthTrend = [];
        for ($i = 6; $i >= 0; $i--) {
            $day = now()->subDays($i)->toDateString();
            $synthTrend[] = ['day' => $day, 'count' => $synthChart[$day]->total ?? 0];
        }

        return response()->json([
            'users' => [
                'total'    => $totalUsers,
                'verified' => $verifiedUsers,
                'today'    => $todaySignups,
                'week'     => $weekSignups,
                'dau'      => $dau,
            ],
            'subscriptions' => [
                'starter' => $starterSubs,
                'pro'     => $proSubs,
                'free'    => $totalUsers - $starterSubs - $proSubs,
            ],
            'activity' => [
                'synthesis_today'  => (int)$synthToday,
                'translation_today' => (int)$transToday,
                'jobs_today'       => $jobsToday,
                'jobs_failed_today' => $jobsFailed,
            ],
            'charts' => [
                'user_growth'  => $growth,
                'synth_trend'  => $synthTrend,
            ],
        ]);
    }
}
