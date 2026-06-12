<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\Cache;

/**
 * Tiny job dispatched by the scheduler every 5 minutes. When it runs,
 * the queue worker is alive — its execution timestamp is the proof
 * the System Check page (and alerting) relies on.
 */
class QueueHeartbeatJob implements ShouldQueue
{
    use Dispatchable, Queueable;

    public function handle(): void
    {
        Cache::put('heartbeat:queue', now()->toIso8601String(), now()->addDay());
    }
}
