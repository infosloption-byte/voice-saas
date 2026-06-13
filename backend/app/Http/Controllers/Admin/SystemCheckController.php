<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\AlertNotifier;
use App\Services\EngineResolver;
use App\Services\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

/**
 * Live health probes for everything the platform depends on. Each check
 * actually exercises the dependency (real query, real HTTP call, real
 * file write) — not just "is the config value present".
 *
 * Statuses: pass | warn | fail. Every non-pass result carries a hint
 * with the concrete fix.
 */
class SystemCheckController extends Controller
{
    /** GET /admin/system-check — run all checks */
    public function index()
    {
        $checks = [];
        foreach ([
            'database', 'redis', 'scheduler', 'queueWorker', 'aiEngine',
            'geminiKey', 'paypalCredentials', 'paypalPlans', 'mailConfig',
            'storageWritable', 'recentBackup', 'diskSpace',
            'pendingMigrations', 'alertWebhooks', 'settingsDecryption',
        ] as $method) {
            try {
                $checks[] = $this->$method();
            } catch (\Throwable $e) {
                $checks[] = $this->result($method, ucfirst($method), 'fail',
                    'Check crashed: ' . $e->getMessage(), 'Inspect laravel.log for the stack trace.');
            }
        }

        return response()->json([
            'checks'  => $checks,
            'ran_at'  => now()->toIso8601String(),
            'summary' => [
                'pass' => count(array_filter($checks, fn($c) => $c['status'] === 'pass')),
                'warn' => count(array_filter($checks, fn($c) => $c['status'] === 'warn')),
                'fail' => count(array_filter($checks, fn($c) => $c['status'] === 'fail')),
            ],
        ]);
    }

    /** POST /admin/system-check/test-email — send a test email to the current admin */
    public function testEmail(Request $request)
    {
        try {
            Mail::raw(
                "This is a test email from the Voxora System Check page.\n\nIf you are reading this, SMTP is configured correctly.",
                fn($m) => $m->to($request->user()->email)->subject('Voxora — System Check test email')
            );
            return response()->json(['message' => "Test email sent to {$request->user()->email}. Check your inbox (and spam)."]);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Send failed: ' . $e->getMessage()], 502);
        }
    }

    /** POST /admin/system-check/test-alert — fire a test alert at the webhooks */
    public function testAlert()
    {
        if (!Settings::get('slack_webhook_url') && !Settings::get('discord_webhook_url')) {
            return response()->json(['message' => 'No webhook configured. Add one under Settings → Alerts first.'], 422);
        }
        // Unique key so the 6h dedupe never swallows a manual test
        AlertNotifier::send('manual-test-' . now()->timestamp,
            'Test alert from the System Check page — alerting is working.');
        return response()->json(['message' => 'Test alert sent — check your Slack/Discord channel.']);
    }

    // ── Individual checks ─────────────────────────────────────────────

    private function database(): array
    {
        $t = microtime(true);
        DB::select('select 1');
        $ms = round((microtime(true) - $t) * 1000, 1);
        return $this->result('database', 'Database (MySQL)',
            $ms > 250 ? 'warn' : 'pass', "connected · {$ms}ms",
            $ms > 250 ? 'Query latency is high — check DB load.' : null);
    }

    private function redis(): array
    {
        try {
            $t = microtime(true);
            \Illuminate\Support\Facades\Redis::connection()->ping();
            $ms = round((microtime(true) - $t) * 1000, 1);
            return $this->result('redis', 'Redis', 'pass', "connected · {$ms}ms");
        } catch (\Throwable $e) {
            // Cache/queue currently run on the database driver, so Redis
            // being down degrades nothing — warn, don't fail.
            return $this->result('redis', 'Redis', 'warn', 'unreachable',
                get_class($e) . ': ' . $e->getMessage());
        }
    }

    private function scheduler(): array
    {
        $last = Cache::get('heartbeat:scheduler');
        if (!$last) {
            return $this->result('scheduler', 'Scheduler (schedule:run)', 'fail', 'never seen',
                'No heartbeat recorded. Start it: docker compose up -d scheduler (or add the schedule:run cron). Digest, alerts, audio prune and backup checks all depend on this.');
        }
        $age = now()->diffInMinutes(\Carbon\Carbon::parse($last));
        if ($age > 3) {
            return $this->result('scheduler', 'Scheduler (schedule:run)', 'fail', "last seen {$age} min ago",
                'Heartbeat is stale — the scheduler stopped. Restart: docker compose restart scheduler');
        }
        return $this->result('scheduler', 'Scheduler (schedule:run)', 'pass', "alive · last beat {$age} min ago");
    }

    private function queueWorker(): array
    {
        $pending = $this->tableCount('jobs');
        $dead    = $this->tableCount('failed_jobs');
        $extra   = "{$pending} pending · {$dead} dead";

        $last = Cache::get('heartbeat:queue');
        if (!$last) {
            return $this->result('queue', 'Queue worker', 'fail', "never seen · {$extra}",
                'No heartbeat job has been processed yet. Start the worker: docker compose up -d queue-worker. (Needs the scheduler running too — it dispatches the heartbeat.)');
        }
        $age = now()->diffInMinutes(\Carbon\Carbon::parse($last));
        if ($age > 12) {
            return $this->result('queue', 'Queue worker', 'fail', "last seen {$age} min ago · {$extra}",
                'Worker heartbeat is stale — emails and bulk jobs are not being processed. Restart: docker compose restart queue-worker');
        }
        if ($dead > 0) {
            return $this->result('queue', 'Queue worker', 'warn', "alive · {$extra}",
                "There are {$dead} failed job(s). Inspect: php artisan queue:failed, retry with queue:retry all.");
        }
        return $this->result('queue', 'Queue worker', 'pass', "alive · last beat {$age} min ago · {$extra}");
    }

    private function aiEngine(): array
    {
        $url = rtrim(EngineResolver::activeUrl(), '/');
        $key = config('services.ai_engine.key', '');
        try {
            $t = microtime(true);
            $resp = Http::withHeaders($key ? ['X-Engine-Key' => $key] : [])
                ->timeout(6)->get($url . '/');
            $ms = round((microtime(true) - $t) * 1000);
            if (in_array($resp->status(), [401, 403])) {
                return $this->result('engine', 'AI Engine', 'fail', "reachable but key rejected (HTTP {$resp->status()})",
                    'AI_ENGINE_API_KEY mismatch between backend and engine .env.');
            }
            if (!$resp->successful()) {
                return $this->result('engine', 'AI Engine', 'fail', "HTTP {$resp->status()}",
                    "Engine at {$url} returned an error. Check: docker logs voice_ai");
            }
            return $this->result('engine', 'AI Engine',
                $ms > 2000 ? 'warn' : 'pass', "online · {$ms}ms · {$url}",
                $ms > 2000 ? 'Engine is responding slowly — may be mid-synthesis or under-resourced.' : null);
        } catch (\Throwable $e) {
            return $this->result('engine', 'AI Engine', 'fail', 'unreachable',
                "Cannot reach {$url}. Check the container: docker compose ps · docker logs voice_ai");
        }
    }

    private function geminiKey(): array
    {
        $key = Settings::get('gemini_api_key');
        if (!$key) {
            return $this->result('gemini', 'Gemini API key (translation)', 'warn', 'not configured',
                'Translation will return 503. Set the key under Settings → Translation.');
        }
        try {
            // Minimal real call — proves the key is alive, not just present
            $resp = Http::timeout(8)->post(
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' . $key,
                ['contents' => [['parts' => [['text' => 'ping']]]], 'generationConfig' => ['maxOutputTokens' => 1]]
            );
            if ($resp->status() === 400 || $resp->status() === 403) {
                return $this->result('gemini', 'Gemini API key (translation)', 'fail', "key rejected (HTTP {$resp->status()})",
                    'The key is invalid or revoked. Rotate it under Settings → Translation.');
            }
            if ($resp->status() === 429) {
                return $this->result('gemini', 'Gemini API key (translation)', 'warn', 'quota exhausted (HTTP 429)',
                    'Key works but is rate-limited/out of quota right now.');
            }
            if (!$resp->successful()) {
                return $this->result('gemini', 'Gemini API key (translation)', 'warn', "HTTP {$resp->status()}",
                    'Unexpected response from the Gemini API.');
            }
            return $this->result('gemini', 'Gemini API key (translation)', 'pass', 'key valid · live call OK');
        } catch (\Throwable) {
            return $this->result('gemini', 'Gemini API key (translation)', 'warn', 'could not reach Gemini API',
                'Network problem reaching generativelanguage.googleapis.com — key not verified.');
        }
    }

    private function paypalCredentials(): array
    {
        $id     = config('services.paypal.client_id', '');
        $secret = config('services.paypal.secret', '');
        $mode   = config('services.paypal.mode', 'sandbox');
        if (!$id || !$secret) {
            return $this->result('paypal', 'PayPal credentials', 'warn', 'not configured',
                'Paid subscriptions cannot be created. Set PAYPAL_CLIENT_ID / PAYPAL_SECRET.');
        }
        try {
            $base = $mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
            $resp = Http::timeout(8)->asForm()
                ->withBasicAuth($id, $secret)
                ->post($base . '/v1/oauth2/token', ['grant_type' => 'client_credentials']);
            if (!$resp->successful()) {
                return $this->result('paypal', 'PayPal credentials', 'fail', "auth rejected (HTTP {$resp->status()}) · mode: {$mode}",
                    'client_id/secret is wrong for this mode. Check the PayPal developer dashboard.');
            }
            return $this->result('paypal', 'PayPal credentials', 'pass', "OAuth OK · mode: {$mode}");
        } catch (\Throwable) {
            return $this->result('paypal', 'PayPal credentials', 'warn', 'could not reach PayPal',
                'Network problem reaching the PayPal API — credentials not verified.');
        }
    }

    private function paypalPlans(): array
    {
        $starter = Settings::get('paypal_plan_starter');
        $pro     = Settings::get('paypal_plan_pro');
        $missing = array_keys(array_filter(['Starter' => !$starter, 'Pro' => !$pro]));
        if ($missing) {
            return $this->result('paypal_plans', 'PayPal plan IDs', 'warn',
                'missing: ' . implode(', ', $missing),
                'Users cannot subscribe to those plans. Set the IDs under Settings → PayPal.');
        }
        return $this->result('paypal_plans', 'PayPal plan IDs', 'pass', 'Starter + Pro configured');
    }

    private function mailConfig(): array
    {
        $host = config('mail.mailers.smtp.host');
        $user = config('mail.mailers.smtp.username');
        $from = config('mail.from.address');
        if (!$host || !$user) {
            return $this->result('mail', 'Mail (SMTP)', 'fail', 'not configured',
                'Verification, resets, digests and broadcasts will all fail. Set MAIL_* in backend .env.');
        }
        return $this->result('mail', 'Mail (SMTP)', 'pass',
            "{$host} · from {$from}",
            'Config present. Use "Send test email" to verify delivery end-to-end.');
    }

    private function storageWritable(): array
    {
        $disk = env('AUDIO_DISK', 'local') === 's3' ? 's3' : 'audio';
        try {
            $path = 'system-check/' . uniqid() . '.txt';
            $t = microtime(true);
            Storage::disk($disk)->put($path, 'system check ' . now());
            Storage::disk($disk)->delete($path);
            $ms = round((microtime(true) - $t) * 1000);
            return $this->result('storage', "Audio storage ({$disk})", 'pass', "write/delete OK · {$ms}ms");
        } catch (\Throwable $e) {
            return $this->result('storage', "Audio storage ({$disk})", 'fail', 'write failed',
                $disk === 's3'
                    ? 'S3 write failed — check AWS keys, bucket name and region: ' . $e->getMessage()
                    : 'Local disk write failed — check permissions on storage/: ' . $e->getMessage());
        }
    }

    private function recentBackup(): array
    {
        $dir = env('BACKUP_DIR', '/home/user/voice-saas/backups');
        if (!is_dir($dir)) {
            return $this->result('backup', 'Database backup', 'warn', "backup dir not visible: {$dir}",
                'If backups run on the host, mount the dir into the backend container and set BACKUP_DIR, otherwise this check cannot see them.');
        }
        $newest = 0;
        foreach (glob($dir . '/*.sql.gz') ?: [] as $f) $newest = max($newest, filemtime($f));
        if ($newest === 0) {
            return $this->result('backup', 'Database backup', 'fail', 'no .sql.gz files found',
                'No backups exist. Check the 03:15 cron and /var/log/voxora-backup.log on the host.');
        }
        $hours = round((time() - $newest) / 3600, 1);
        return $this->result('backup', 'Database backup',
            $hours > 25 ? 'fail' : 'pass', "last backup {$hours}h ago",
            $hours > 25 ? 'Backup is older than 25h — the host cron may have failed. Check /var/log/voxora-backup.log.' : null);
    }

    private function diskSpace(): array
    {
        $total = @disk_total_space(storage_path());
        $free  = @disk_free_space(storage_path());
        if (!$total || $free === false) {
            return $this->result('disk', 'Disk space', 'warn', 'could not measure', null);
        }
        $pct = round(($total - $free) / $total * 100, 1);
        $freeGb = round($free / 1073741824, 1);
        $status = $pct >= 90 ? 'fail' : ($pct >= 80 ? 'warn' : 'pass');
        return $this->result('disk', 'Disk space', $status, "{$pct}% used · {$freeGb} GB free",
            $status !== 'pass' ? 'Free space is low — prune old audio (php artisan audio:prune) or grow the volume.' : null);
    }

    private function pendingMigrations(): array
    {
        $ran   = DB::table('migrations')->pluck('migration')->all();
        $files = collect(glob(database_path('migrations/*.php')))
            ->map(fn($f) => basename($f, '.php'));
        $pending = $files->diff($ran)->values();
        if ($pending->isNotEmpty()) {
            return $this->result('migrations', 'Migrations', 'fail',
                $pending->count() . ' pending: ' . $pending->take(3)->implode(', ') . ($pending->count() > 3 ? '…' : ''),
                'Run: docker exec voice_backend php artisan migrate --force');
        }
        return $this->result('migrations', 'Migrations', 'pass', 'all ' . count($ran) . ' applied');
    }

    private function alertWebhooks(): array
    {
        $slack   = (bool) Settings::get('slack_webhook_url');
        $discord = (bool) Settings::get('discord_webhook_url');
        if (!$slack && !$discord) {
            return $this->result('alerts', 'Alert webhooks', 'warn', 'none configured',
                'System alerts (failure spikes, queue backlog, disk) have nowhere to go. Add a webhook under Settings → Alerts.');
        }
        $targets = implode(' + ', array_keys(array_filter(['Slack' => $slack, 'Discord' => $discord])));
        return $this->result('alerts', 'Alert webhooks', 'pass', $targets . ' configured',
            'Use "Send test alert" to verify delivery.');
    }

    private function settingsDecryption(): array
    {
        $row = DB::table('app_settings')->where('is_secret', true)->first();
        if (!$row) {
            return $this->result('appkey', 'APP_KEY / settings encryption', 'pass', 'no stored secrets yet');
        }
        try {
            Crypt::decryptString($row->value);
            return $this->result('appkey', 'APP_KEY / settings encryption', 'pass', 'stored secrets decrypt OK');
        } catch (\Throwable) {
            return $this->result('appkey', 'APP_KEY / settings encryption', 'fail',
                "cannot decrypt '{$row->key}'",
                'APP_KEY changed since this secret was saved. Re-enter affected secrets in Settings.');
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private function result(string $id, string $label, string $status, string $value, ?string $hint = null): array
    {
        return compact('id', 'label', 'status', 'value', 'hint');
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
