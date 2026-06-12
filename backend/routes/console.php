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
