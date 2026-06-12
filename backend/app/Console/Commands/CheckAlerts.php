<?php

namespace App\Console\Commands;

use App\Services\AlertNotifier;
use App\Services\Settings;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class CheckAlerts extends Command
{
    protected $signature   = 'admin:check-alerts';
    protected $description = 'Check system health and push alerts to the configured webhooks';

    public function handle(): int
    {
        if (!Settings::get('slack_webhook_url') && !Settings::get('discord_webhook_url')) {
            $this->info('No alert webhook configured — skipping.');
            return self::SUCCESS;
        }

        // 1. Failure rate over the last hour
        $hour = DB::table('activity_logs')
            ->where('started_at', '>=', now()->subHour())
            ->selectRaw("COUNT(*) as total, SUM(status = 'failed') as failed")
            ->first();
        $total  = (int) ($hour->total ?? 0);
        $failed = (int) ($hour->failed ?? 0);
        if ($total >= 10 && $failed / $total >= 0.25) {
            $pct = round($failed / $total * 100);
            AlertNotifier::send('failure_rate', "{$pct}% of jobs failed in the last hour ({$failed}/{$total}).");
        }

        // 2. Queue backlog / dead jobs
        $pending = $this->tableCount('jobs');
        if ($pending > 100) {
            AlertNotifier::send('queue_backlog', "Queue backlog: {$pending} pending jobs.");
        }
        $dead = $this->tableCount('failed_jobs');
        if ($dead > 0) {
            AlertNotifier::send('queue_failed', "{$dead} job(s) in the failed_jobs table.");
        }

        // 3. Disk usage
        $diskTotal = @disk_total_space(storage_path());
        $diskFree  = @disk_free_space(storage_path());
        if ($diskTotal && $diskFree !== false) {
            $usedPct = round(($diskTotal - $diskFree) / $diskTotal * 100);
            if ($usedPct >= 90) {
                AlertNotifier::send('disk_usage', "Disk {$usedPct}% full on the storage volume.");
            }
        }

        $this->info('Alert checks complete.');
        return self::SUCCESS;
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
