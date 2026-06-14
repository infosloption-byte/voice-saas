<?php

namespace App\Http\Controllers;

use App\Jobs\BulkSynthesisJob;
use App\Models\ActivityLog;
use App\Models\Script;
use App\Services\EngineResolver;
use App\Services\SynthesisQuota;
use App\Services\VoiceProfileStore;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class EngineSynthesisProxyController extends Controller
{
    /** How long a job's owner binding is remembered (seconds). */
    private const JOB_TTL = 3600;

    /** How long a generate batch is remembered for quota de-duplication. */
    private const BATCH_TTL = 3600;

    private function engineUrl(): string
    {
        return rtrim(EngineResolver::activeUrl(), '/');
    }

    private function engineHeaders(): array
    {
        $key = config('services.ai_engine.key', '');
        return $key ? ['X-Engine-Key' => $key] : [];
    }

    /**
     * Resolve the authenticated user via the session/token, if any.
     * Routes are public (guests synthesize too), so this may be null.
     */
    private function user(Request $request)
    {
        // SPA cookie auth populates $request->user() (statefulApi is enabled);
        // fall back to the sanctum token guard for API-token clients.
        if ($u = $request->user()) {
            return $u;
        }
        try {
            return auth('sanctum')->user();
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Enforce + record synthesis quota for authenticated users, deduped per
     * "generate" action via the client-supplied batch_id (so a chunked
     * synthesis — many submits for one generate — only counts once).
     *
     * Returns a JSON error response when over quota, or null to proceed.
     */
    private function enforceQuota(Request $request, $user)
    {
        if (! $user) {
            return null; // guests are gated client-side + by route throttle
        }

        $batchId = (string) $request->input('batch_id', '');

        // Already counted this generate (a later chunk) — let it through.
        if ($batchId !== '' && Cache::has($this->batchCacheKey($user, $batchId))) {
            return null;
        }

        if (! SynthesisQuota::hasRemaining($user)) {
            $snap = SynthesisQuota::snapshot($user);
            $msg  = "Synthesis quota reached ({$snap['limit']} per {$snap['period']}). Upgrade your plan for more.";
            return response()->json([
                'detail'  => $msg,
                'message' => $msg,
                'code'    => 'plan_limit_synth',
            ], 429);
        }

        SynthesisQuota::record($user);

        if ($batchId !== '') {
            Cache::put($this->batchCacheKey($user, $batchId), true, self::BATCH_TTL);
        }

        return null;
    }

    private function batchCacheKey($user, string $batchId): string
    {
        return "synth_batch:{$user->id}:{$batchId}";
    }

    private function jobOwnerKey(string $jobId): string
    {
        return "synth_job_owner:{$jobId}";
    }

    /**
     * Reject status/result polling for a job owned by a *different*
     * authenticated user. Job ids are unguessable UUIDs, so this is
     * defence-in-depth for the cross-user case.
     */
    private function denyIfNotOwner(Request $request, string $jobId)
    {
        $owner = Cache::get($this->jobOwnerKey($jobId));
        if ($owner === null) {
            return null; // no recorded owner (guest job / expired) — allow
        }

        $user = $this->user($request);
        if ($user && (string) $user->id === (string) $owner) {
            return null;
        }

        return response()->json(['detail' => 'Job not found or expired.'], 404);
    }

    /**
     * Make sure every voice profile referenced by this request is present on
     * the active engine, provisioning from shared storage if needed. Covers
     * the single `profile_id` field and any engine_keys inside `speaker_map`.
     */
    private function ensureProfiles(Request $request, string $engineUrl): void
    {
        $keys = [];

        if ($pid = $request->input('profile_id')) {
            $keys[] = $pid;
        }

        if ($map = $request->input('speaker_map')) {
            $decoded = is_string($map) ? json_decode($map, true) : $map;
            if (is_array($decoded)) {
                foreach ($decoded as $engineKey) {
                    if (is_string($engineKey)) {
                        $keys[] = $engineKey;
                    }
                }
            }
        }

        foreach (array_unique($keys) as $key) {
            VoiceProfileStore::ensureOnEngine($engineUrl, $key);
        }
    }

    private function buildMultipart(Request $request)
    {
        // retry(): one extra attempt on transient connection failures so a
        // brief network blip to the engine doesn't surface as a user-facing 502.
        $pending = Http::withHeaders($this->engineHeaders())
            ->retry(2, 300, throw: false)
            ->asMultipart();

        foreach ($request->post() as $name => $value) {
            $pending = $pending->attach($name, (string) $value);
        }
        foreach ($request->allFiles() as $name => $file) {
            $pending = $pending->attach(
                $name,
                file_get_contents($file->getRealPath()),
                $file->getClientOriginalName(),
                ['Content-Type' => $file->getMimeType()]
            );
        }

        return $pending;
    }

    /** POST /api/engine/synthesize/submit  — forward multipart to the active engine */
    public function submit(Request $request)
    {
        $user = $this->user($request);
        if ($blocked = $this->enforceQuota($request, $user)) {
            return $blocked;
        }

        $engineUrl = $this->engineUrl();

        try {
            $this->ensureProfiles($request, $engineUrl);

            $resp = $this->buildMultipart($request)->timeout(30)->post($engineUrl . '/synthesize/submit');

            // Bind the new job to its owner for cross-user protection.
            if ($user && $resp->successful()) {
                $jobId = $resp->json('job_id');
                if (is_string($jobId) && $jobId !== '') {
                    Cache::put($this->jobOwnerKey($jobId), (string) $user->id, self::JOB_TTL);
                }
            }

            return response($resp->body(), $resp->status())
                ->header('Content-Type', 'application/json');
        } catch (\Throwable $e) {
            return response()->json(['detail' => 'Engine proxy error: ' . $e->getMessage()], 502);
        }
    }

    /** GET /api/engine/synthesize/status/{jobId} */
    public function status(Request $request, string $jobId)
    {
        if ($denied = $this->denyIfNotOwner($request, $jobId)) {
            return $denied;
        }

        try {
            $resp = Http::timeout(10)
                ->retry(2, 300, throw: false)
                ->withHeaders($this->engineHeaders())
                ->get($this->engineUrl() . '/synthesize/status/' . $jobId);

            return response($resp->body(), $resp->status())
                ->header('Content-Type', 'application/json');
        } catch (\Throwable $e) {
            return response()->json(['detail' => 'Engine proxy error: ' . $e->getMessage()], 502);
        }
    }

    /** GET /api/engine/synthesize/result/{jobId} */
    public function result(Request $request, string $jobId)
    {
        if ($denied = $this->denyIfNotOwner($request, $jobId)) {
            return $denied;
        }

        try {
            $resp = Http::timeout(120)
                ->withOptions(['stream' => true])
                ->withHeaders($this->engineHeaders())
                ->get($this->engineUrl() . '/synthesize/result/' . $jobId);

            $contentType = $resp->header('Content-Type') ?? 'audio/wav';

            return response($resp->body(), $resp->status())->header('Content-Type', $contentType);
        } catch (\Throwable $e) {
            return response()->json(['detail' => 'Engine proxy error: ' . $e->getMessage()], 502);
        }
    }

    /** POST /api/engine/synthesize  — legacy synchronous path */
    public function legacy(Request $request)
    {
        $user = $this->user($request);
        if ($blocked = $this->enforceQuota($request, $user)) {
            return $blocked;
        }

        $engineUrl = $this->engineUrl();

        try {
            $this->ensureProfiles($request, $engineUrl);

            $resp = $this->buildMultipart($request)->timeout(120)->post($engineUrl . '/synthesize');

            $contentType = $resp->header('Content-Type') ?? 'audio/wav';
            return response($resp->body(), $resp->status())
                ->header('Content-Type', $contentType);
        } catch (\Throwable $e) {
            return response()->json(['detail' => 'Engine proxy error: ' . $e->getMessage()], 502);
        }
    }

    /**
     * POST /api/engine/synthesize/bulk-queue
     *
     * Validates the request, creates an ActivityLog entry, and dispatches a
     * BulkSynthesisJob so synthesis continues even if the browser tab closes.
     */
    public function queueBulk(Request $request)
    {
        $user = $request->user();

        $validated = $request->validate([
            'script_ids' => ['required', 'array', 'min:1', 'max:50'],
            'script_ids.*' => ['string', 'max:50'],
            'engine'     => ['required', 'string', 'in:xtts,f5'],
            'project_id' => ['required', 'string', 'max:50'],
        ]);

        $projectId = $validated['project_id'];
        $scriptIds = $validated['script_ids'];
        $engine    = $validated['engine'];

        // Verify all scripts belong to the authenticated user's project.
        $ownedCount = Script::whereIn('id', $scriptIds)
            ->where('project_id', $projectId)
            ->whereHas('project', fn ($q) => $q->where('user_id', $user->id))
            ->count();

        if ($ownedCount !== count($scriptIds)) {
            return response()->json([
                'message' => 'One or more scripts do not belong to your project.',
            ], 422);
        }

        $log = ActivityLog::create([
            'user_id'    => $user->id,
            'project_id' => $projectId,
            'event_type' => 'synthesis',
            'message'    => 'Bulk synthesis queued: ' . count($scriptIds) . ' scripts',
            'status'     => 'running',
            'started_at' => now(),
        ]);

        BulkSynthesisJob::dispatch(
            $user->id,
            $projectId,
            $scriptIds,
            $engine,
            $log->id,
        );

        return response()->json([
            'queued'          => true,
            'activity_log_id' => $log->id,
            'script_count'    => count($scriptIds),
        ]);
    }
}
