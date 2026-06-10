<?php

namespace App\Console\Commands;

use App\Models\EngineConfig;
use App\Models\VoiceProfile;
use App\Services\VoiceProfileStore;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class VoiceProfilesDoctor extends Command
{
    protected $signature = 'voice-profiles:doctor {--backfill : Copy profiles missing from S3 from any reachable engine}';

    protected $description = 'Check shared (S3) voice-profile storage and report/repair missing copies';

    public function handle(): int
    {
        // ── 1. Is shared storage configured? ─────────────────────────
        $this->line('');
        $this->info('1) Shared storage configuration');
        if (! VoiceProfileStore::enabled()) {
            $this->error('   ✗ No S3 bucket configured (filesystems.disks.s3.bucket is empty).');
            $this->line('     Set AWS_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION,');
            $this->line('     then run: php artisan config:clear');
            return self::FAILURE;
        }
        $this->line('   ✓ Bucket: ' . config('filesystems.disks.s3.bucket'));
        $this->line('   ✓ Region: ' . config('filesystems.disks.s3.region'));
        $this->line('   ✓ Endpoint: ' . (config('filesystems.disks.s3.endpoint') ?: 'AWS default'));

        // ── 2. Can we actually read/write the bucket? ────────────────
        $this->info('2) S3 connectivity self-test (write → read → delete)');
        $probeKey = 'voice-profiles/_doctor-' . Str::random(8) . '.txt';
        $payload  = 'ok-' . now()->timestamp;
        try {
            Storage::disk('s3')->put($probeKey, $payload);
            $read = Storage::disk('s3')->get($probeKey);
            Storage::disk('s3')->delete($probeKey);
            if ($read !== $payload) {
                $this->error('   ✗ Read back wrong data — check bucket permissions.');
                return self::FAILURE;
            }
            $this->line('   ✓ Read/write/delete works.');
        } catch (\Throwable $e) {
            $this->error('   ✗ S3 error: ' . $e->getMessage());
            $this->line('     Common causes: wrong keys, wrong region, bucket name typo,');
            $this->line('     or (for R2/Spaces/MinIO) missing AWS_ENDPOINT + AWS_USE_PATH_STYLE_ENDPOINT=true');
            return self::FAILURE;
        }

        // ── 3. Inventory: DB profiles vs S3 copies ───────────────────
        $this->info('3) Profile inventory (database vs S3)');
        $profiles = VoiceProfile::all();
        if ($profiles->isEmpty()) {
            $this->line('   (no voice profiles in the database yet)');
            return self::SUCCESS;
        }

        $missing = [];
        foreach ($profiles as $p) {
            $inS3 = $p->engine_key
                && Storage::disk('s3')->exists(VoiceProfileStore::objectKey($p->engine_key));
            $this->line(sprintf(
                '   %s  %-28s  engine_key=%s',
                $inS3 ? '✓' : '✗',
                Str::limit($p->name ?? $p->profile_id, 26),
                $p->engine_key ?? '(none)'
            ));
            if (! $inS3 && $p->engine_key) {
                $missing[] = $p;
            }
        }

        $this->line('');
        $this->line(sprintf('   %d profile(s), %d missing from S3.', $profiles->count(), count($missing)));

        if (empty($missing)) {
            $this->info('All profiles are in shared storage. ✔');
            return self::SUCCESS;
        }

        // ── 4. Optional backfill from a reachable engine ─────────────
        if (! $this->option('backfill')) {
            $this->warn('   Run with --backfill to pull missing profiles from a reachable engine into S3.');
            return self::SUCCESS;
        }

        $this->info('4) Backfilling missing profiles from engines');
        $engines = EngineConfig::all();
        if ($engines->isEmpty()) {
            $engines = collect([(object) ['name' => 'default', 'url' => config('services.ai_engine.url')]]);
        }
        $apiKey  = config('services.ai_engine.key', '');
        $headers = $apiKey ? ['X-Engine-Key' => $apiKey] : [];

        $fixed = 0;
        foreach ($missing as $p) {
            $done = false;
            foreach ($engines as $engine) {
                $url = rtrim($engine->url, '/') . '/voice-profile/' . $p->engine_key . '/preview';
                try {
                    $resp = Http::timeout(30)->withHeaders($headers)->get($url);
                    if ($resp->successful()) {
                        Storage::disk('s3')->put(
                            VoiceProfileStore::objectKey($p->engine_key),
                            $resp->body()
                        );
                        $this->line("   ✓ {$p->name}  ← {$engine->name}");
                        $fixed++;
                        $done = true;
                        break;
                    }
                } catch (\Throwable $e) {
                    // try next engine
                }
            }
            if (! $done) {
                $this->line("   ✗ {$p->name}  — not found on any engine (re-record this one)");
            }
        }

        $this->line('');
        $this->info("Backfill complete: {$fixed} of " . count($missing) . ' recovered.');
        return self::SUCCESS;
    }
}
