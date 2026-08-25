<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Delete audio files not updated in 90 days (configurable via AUDIO_PRUNE_DAYS).
Schedule::command('audio:prune', ['--days' => (int) env('AUDIO_PRUNE_DAYS', 90)])
    ->daily()
    ->withoutOverlapping()
    ->runInBackground();

// Delete source/result video files for finished dubbing jobs not updated in
// 90 days (configurable via VIDEO_PRUNE_DAYS). Video is pruned separately
// from — and later in the hour than — audio since these are much larger
// files on a separate disk; staggering avoids both prune jobs doing heavy
// disk I/O in the same minute on a single-box deploy.
Schedule::command('video:prune', ['--days' => (int) env('VIDEO_PRUNE_DAYS', 90)])
    ->dailyAt('01:30')
    ->withoutOverlapping()
    ->runInBackground();

// Check that a database backup exists from the last 25 hours.
Schedule::command('backup:check')
    ->daily()
    ->withoutOverlapping();

// Daily KPI digest emailed to admins.
Schedule::command('admin:digest')
    ->dailyAt('08:00')
    ->withoutOverlapping();

// System health alerts to Slack/Discord (webhooks set in admin panel).
Schedule::command('admin:check-alerts')
    ->everyFifteenMinutes()
    ->withoutOverlapping();

// Heartbeats consumed by the admin System Check page:
// - scheduler heartbeat proves schedule:run is firing
// - queue heartbeat job proves the queue worker is processing
Schedule::call(function () {
    \Illuminate\Support\Facades\Cache::put(
        'heartbeat:scheduler', now()->toIso8601String(), now()->addDay()
    );
})->everyMinute()->name('scheduler-heartbeat');

Schedule::call(function () {
    \App\Jobs\QueueHeartbeatJob::dispatch();
})->everyFiveMinutes()->name('queue-heartbeat');

// Reap orphaned activity logs. Single-script synthesis is driven client-side,
// so a page refresh mid-task leaves the log stuck in "running" forever (the
// browser never sends the done/fail signal). Anything still running after an
// hour — longer than the bulk job's own 1h timeout — is certainly dead.
Schedule::call(function () {
    \App\Models\ActivityLog::where('status', 'running')
        ->where('started_at', '<', now()->subHour())
        ->update([
            'status'   => 'failed',
            'detail'   => 'Marked failed automatically — the task was interrupted (e.g. the page was closed) and never reported completion.',
            'ended_at' => now(),
        ]);
})->everyFifteenMinutes()->name('reap-stale-activity-logs');
