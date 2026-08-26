<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Admin\EngineConfigController;
use App\Http\Controllers\Admin\TtsEngineSettingsController;
use App\Http\Controllers\Admin\AdminUserController;
use App\Http\Controllers\Admin\AdminStatsController;
use App\Http\Controllers\Admin\AdminSubscriptionController;
use App\Http\Controllers\Admin\AdminAuditLogController;
use App\Http\Controllers\Admin\AdminBroadcastController;
use App\Http\Controllers\Admin\AdminImpersonationController;
use App\Http\Controllers\Admin\AdminReportsController;
use App\Http\Controllers\Admin\AdminSettingsController;
use App\Http\Controllers\Admin\SystemCheckController;
use App\Http\Controllers\ActivityLogController;
use App\Http\Controllers\EngineCapabilitiesController;
use App\Http\Controllers\EngineProxyController;
use App\Http\Controllers\EngineSynthesisProxyController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\EmailVerificationController;
use App\Http\Controllers\GuestLimitsController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\PlanLimitsController;
use App\Http\Controllers\PasswordResetController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\ScriptController;
use App\Http\Controllers\SubscriptionController;
use App\Http\Controllers\SynthesisUsageController;
use App\Http\Controllers\TranslationUsageController;
use App\Http\Controllers\VideoDubbingController;
use App\Http\Controllers\VideoProjectController;
use App\Http\Controllers\VoiceProfileController;

// ── Public auth routes ────────────────────────────────────────────────
Route::middleware('throttle:5,1')->group(function () {
    Route::post('/register',    [AuthController::class, 'register']);
    Route::post('/login',       [AuthController::class, 'login']);
    Route::post('/auth/google', [AuthController::class, 'google']);
});
Route::post('/logout',   [AuthController::class, 'logout'])->middleware('auth:sanctum');

// ── Authenticated routes ──────────────────────────────────────────────
Route::middleware('auth:sanctum')->group(function () {

    // Current user
    Route::get('/user', function (Request $request) {
        $user = $request->user();
        if (!$user) return null;
        // Surface impersonation state so the app can show a banner
        $payload = $user->toArray();
        $payload['impersonated'] = $request->hasSession()
            && $request->session()->has('impersonator_id');
        return $payload;
    });

    // Stop impersonating — outside 'admin' middleware on purpose: the
    // current session user is the impersonated (non-admin) user
    Route::post('/impersonation/stop', [AdminImpersonationController::class, 'stop']);
    Route::put('/user',           [AuthController::class, 'updateProfile']);
    Route::post('/user/password', [AuthController::class, 'changePassword']);
    Route::delete('/user',        [AuthController::class, 'deleteAccount']);

    // Projects
    Route::apiResource('projects', ProjectController::class);

    Route::post('scripts/{script}/audio', [ScriptController::class, 'saveAudio']);
    Route::get( 'scripts/{script}/audio', [ScriptController::class, 'serveAudio']);

    Route::post('scripts/update', [ScriptController::class, 'flatUpdate']);

    // Scripts (nested under projects)
    Route::post(
        'projects/{project}/scripts/reorder',
        [ScriptController::class, 'reorder']
    );
    Route::apiResource('projects.scripts', ScriptController::class)
        ->only(['store', 'update', 'destroy'])
        ->scoped([
            'script'  => 'id',
            'project' => 'id',
        ]);

    // Activity logs
    Route::get(   'activity-logs',              [ActivityLogController::class, 'index']);
    Route::post(  'activity-logs',              [ActivityLogController::class, 'store']);
    Route::get(   'activity-logs/{activityLog}', [ActivityLogController::class, 'show']);
    Route::match(['put', 'patch'], 'activity-logs/{activityLog}', [ActivityLogController::class, 'update']);
    Route::delete('activity-logs',              [ActivityLogController::class, 'destroy']);

    // Voice profiles
    // GET  /api/voice-profiles        → list user's profiles
    // POST /api/voice-profiles        → save profile (with optional audio file forwarded to engine)
    // DELETE /api/voice-profiles/{id} → delete profile
    Route::get(   'voice-profiles',      [VoiceProfileController::class, 'index']);
    // Uploads forward a file to the engine + S3; throttle to curb storage/bandwidth abuse.
    Route::post(  'voice-profiles',      [VoiceProfileController::class, 'store'])->middleware('throttle:10,1');
    Route::delete('voice-profiles/{id}', [VoiceProfileController::class, 'destroy']);
});

// ── Password reset (public, throttled) ───────────────────────────────
Route::middleware('throttle:5,1')->group(function () {
    Route::post('/forgot-password', [PasswordResetController::class, 'sendResetLink']);
    Route::post('/reset-password',  [PasswordResetController::class, 'reset']);
});

// ── Email verification: verify link is public (comes from email) ─────
Route::get('/email/verify/{id}/{hash}', [EmailVerificationController::class, 'verify'])
     ->name('verification.verify');

// ── Synthesis quota (authenticated) ─────────────────────────────────
Route::middleware('auth:sanctum')->group(function () {
    Route::get( 'synthesis/quota',  [SynthesisUsageController::class, 'quota']);
    Route::post('synthesis/record', [SynthesisUsageController::class, 'record']);
});

// ── Translation quota (authenticated) ────────────────────────────────
Route::middleware('auth:sanctum')->group(function () {
    Route::get( 'translation/quota',  [TranslationUsageController::class, 'quota']);
    Route::post('translation/record', [TranslationUsageController::class, 'record']);
});

// ── Authenticated routes: resend + subscriptions + data export ────────
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/email/verify/resend', [EmailVerificationController::class, 'resend'])
         ->middleware('throttle:6,1');
    Route::get('/user/export', [AuthController::class, 'exportData']);

    // Subscriptions
    Route::get( '/subscription',              [SubscriptionController::class, 'current']);
    Route::get( '/subscription/transactions', [SubscriptionController::class, 'transactions']);
    Route::post('/subscription/create',       [SubscriptionController::class, 'create']);
    Route::post('/subscription/capture',      [SubscriptionController::class, 'capture']);
    Route::post('/subscription/cancel',       [SubscriptionController::class, 'cancel']);
});

// ── PayPal webhook (public — no auth) ────────────────────────────────
Route::post('/subscription/webhook', [SubscriptionController::class, 'webhook']);

// ── Engine proxy (public — routes synthesis to the active engine) ────
// Synthesis is GPU-expensive, so it is rate-limited to curb scripted abuse /
// DoS. Authenticated users additionally have their plan quota enforced inside
// the controller; guests are gated client-side. Job ids are constrained to the
// engine's hex-UUID format to block path traversal on the {jobId} segment.
Route::get('/engine/capabilities', [EngineCapabilitiesController::class, 'show']);

Route::middleware('throttle:30,1')->group(function () {
    Route::post('/engine/synthesize/submit', [EngineSynthesisProxyController::class, 'submit']);
    Route::post('/engine/synthesize',        [EngineSynthesisProxyController::class, 'legacy']);
});

Route::middleware('throttle:120,1')->group(function () {
    Route::get('/engine/synthesize/status/{jobId}', [EngineSynthesisProxyController::class, 'status'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
    Route::get('/engine/synthesize/result/{jobId}', [EngineSynthesisProxyController::class, 'result'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
});

// Authenticated: queue a bulk synthesis job that runs server-side.
Route::middleware(['auth:sanctum', 'throttle:10,1'])->group(function () {
    Route::post('/engine/synthesize/bulk-queue', [EngineSynthesisProxyController::class, 'queueBulk']);
});

// ── Video Studio projects (task #15 Phase 1, authenticated) ────────────
// Project CRUD is cheap (no ffmpeg/GPU work, just DB rows), so it shares
// the same throttle tiers as ProjectController's own routes rather than
// the heavier per-request cost the /dubbing/* group below is gated for.
Route::middleware(['auth:sanctum', 'throttle:20,1'])->group(function () {
    Route::get(   '/video-projects',        [VideoProjectController::class, 'index']);
    Route::post(  '/video-projects',        [VideoProjectController::class, 'store']);
    Route::get(   '/video-projects/{id}',   [VideoProjectController::class, 'show'])
        ->where('id', '[A-Za-z0-9\-]{1,64}');
    Route::match(['put', 'patch'], '/video-projects/{id}', [VideoProjectController::class, 'update'])
        ->where('id', '[A-Za-z0-9\-]{1,64}');
});

// Delete gets its own tier, same reasoning as /dubbing/{jobId}'s delete
// group just below — destructive, not a read.
Route::middleware(['auth:sanctum', 'throttle:15,1'])->group(function () {
    Route::delete('/video-projects/{id}', [VideoProjectController::class, 'destroy'])
        ->where('id', '[A-Za-z0-9\-]{1,64}');
});

// Task #15 Phase 2 — media bin asset upload. Same weight/throttle
// reasoning as /dubbing/submit just below (real file upload, real disk
// I/O, ffprobe on video/audio) rather than the cheap-CRUD tier above.
Route::middleware(['auth:sanctum', 'throttle:5,1'])->group(function () {
    Route::post('/video-projects/{id}/assets', [VideoProjectController::class, 'addAsset'])
        ->where('id', '[A-Za-z0-9\-]{1,64}');
});

// Asset file read — same 60/min read tier as /dubbing/source and
// /dubbing/result, since the media library's thumbnails/previews poll
// this per asset the same way those poll per job.
Route::middleware(['auth:sanctum', 'throttle:60,1'])->group(function () {
    Route::get('/video-projects/{id}/assets/{assetId}/file', [VideoProjectController::class, 'assetFile'])
        ->where(['id' => '[A-Za-z0-9\-]{1,64}', 'assetId' => '[A-Za-z0-9\-]{1,64}']);
});

// Asset delete — same destructive-tier reasoning as the project delete
// group just above.
Route::middleware(['auth:sanctum', 'throttle:15,1'])->group(function () {
    Route::delete('/video-projects/{id}/assets/{assetId}', [VideoProjectController::class, 'deleteAsset'])
        ->where(['id' => '[A-Za-z0-9\-]{1,64}', 'assetId' => '[A-Za-z0-9\-]{1,64}']);
});

// Task #15 Phase 3 — "Dub this clip". Same throttle tier as addAsset:
// this dispatches a real queued job (PrepareDubbingJob), not just a DB
// row, so it belongs with the heavier action tier rather than the cheap
// project-CRUD tier above.
Route::middleware(['auth:sanctum', 'throttle:5,1'])->group(function () {
    Route::post('/video-projects/{id}/assets/{assetId}/dub', [VideoProjectController::class, 'dubClip'])
        ->where(['id' => '[A-Za-z0-9\-]{1,64}', 'assetId' => '[A-Za-z0-9\-]{1,64}']);
});

// Task #15 Phase 4 — extract audio → transcribe → clone-resynthesize.
// extractAudio()/resynthesize() both dispatch a real queued job, same
// heavier tier as dubClip() just above. updateTranscript() is cheap
// project-CRUD (a DB row edit, no job dispatched) — same tier as
// addAsset()'s sibling endpoints, not this heavier one.
Route::middleware(['auth:sanctum', 'throttle:5,1'])->group(function () {
    Route::post('/video-projects/{id}/assets/{assetId}/extract-audio', [VideoProjectController::class, 'extractAudio'])
        ->where(['id' => '[A-Za-z0-9\-]{1,64}', 'assetId' => '[A-Za-z0-9\-]{1,64}']);
    Route::post('/video-projects/{id}/assets/{assetId}/resynthesize', [VideoProjectController::class, 'resynthesize'])
        ->where(['id' => '[A-Za-z0-9\-]{1,64}', 'assetId' => '[A-Za-z0-9\-]{1,64}']);
});
Route::middleware(['auth:sanctum', 'throttle:30,1'])->group(function () {
    Route::patch('/video-projects/{id}/assets/{assetId}/transcript', [VideoProjectController::class, 'updateTranscript'])
        ->where(['id' => '[A-Za-z0-9\-]{1,64}', 'assetId' => '[A-Za-z0-9\-]{1,64}']);
});

// ── Video dubbing (task #6, authenticated, queued job) ─────────────────
// No guest tier: unlike clone-voice/translate, a dubbing job consumes both
// translation AND synthesis quota plus real ffmpeg/GPU time per video, so
// it's gated behind an account from day one. submit is throttled tighter
// than bulk-queue (5/min vs 10/min) since a video job is much heavier per
// request; status/result/source/index use the same jobId format constraint
// as the engine's own job endpoints to block path traversal.
Route::middleware(['auth:sanctum', 'throttle:5,1'])->group(function () {
    Route::post('/dubbing/submit', [VideoDubbingController::class, 'submit']);
    Route::post('/dubbing/{jobId}/retry', [VideoDubbingController::class, 'retry'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
    // finalize() is also a "start a heavy job" action (synthesis + mux),
    // same throttle tier as submit/retry for the same reason.
    Route::post('/dubbing/{jobId}/finalize', [VideoDubbingController::class, 'finalize'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
});

Route::middleware(['auth:sanctum', 'throttle:60,1'])->group(function () {
    Route::get('/dubbing', [VideoDubbingController::class, 'index']);
    Route::get('/dubbing/status/{jobId}', [VideoDubbingController::class, 'status'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
    Route::get('/dubbing/result/{jobId}', [VideoDubbingController::class, 'result'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
    Route::get('/dubbing/source/{jobId}', [VideoDubbingController::class, 'source'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
    Route::get('/dubbing/{jobId}/segments', [VideoDubbingController::class, 'segments'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
    Route::get('/dubbing/{jobId}/thumbnails', [VideoDubbingController::class, 'thumbnails'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
    Route::get('/dubbing/{jobId}/thumbnails/sprite.jpg', [VideoDubbingController::class, 'thumbnailSprite'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
});

// Review-timeline edits (retiming/text changes) get their own throttle —
// dragging a segment block can fire several saves in quick succession, more
// than a 5/min action-tier route should have to absorb, but it's still a
// write so it shouldn't share the 60/min read-polling tier either.
Route::middleware(['auth:sanctum', 'throttle:40,1'])->group(function () {
    Route::patch('/dubbing/{jobId}/segments', [VideoDubbingController::class, 'updateSegments'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
    Route::post('/dubbing/{jobId}/segments/{segmentId}/split', [VideoDubbingController::class, 'splitSegment'])
        ->where(['jobId' => '[A-Za-z0-9\-]{1,64}', 'segmentId' => '[A-Za-z0-9\-]{1,64}']);
    Route::post('/dubbing/{jobId}/segments/merge', [VideoDubbingController::class, 'mergeSegments'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
});

// Delete gets its own (slightly tighter) throttle group — it's a
// destructive action, not a read, so it shouldn't share status/result's
// generous read-polling allowance.
Route::middleware(['auth:sanctum', 'throttle:30,1'])->group(function () {
    Route::delete('/dubbing/{jobId}', [VideoDubbingController::class, 'destroy'])
        ->where('jobId', '[A-Za-z0-9\-]{1,64}');
});

// ── Engine proxy: endpoints the frontend used to call directly (/ai/...) ──
// The engine is no longer publicly exposed; everything routes through here so
// the engine API key stays server-side. clone-voice/translate/voice-preview
// stay public (guests use them) but are throttled; the rest require auth.
Route::middleware('throttle:20,1')->group(function () {
    Route::post('/engine/clone-voice',          [EngineProxyController::class, 'cloneVoice']);
    Route::post('/engine/translate',            [EngineProxyController::class, 'translate']);
    Route::get ('/engine/voice-preview/{speaker}', [EngineProxyController::class, 'voicePreview'])
        ->where('speaker', '[A-Za-z0-9 %_\-]{1,100}');
});

Route::middleware(['auth:sanctum', 'throttle:30,1'])->group(function () {
    Route::post('/engine/transcribe', [EngineProxyController::class, 'transcribe']);
    Route::post('/engine/export-mp3', [EngineProxyController::class, 'exportMp3']);
    Route::get ('/engine/voice-profile/{id}/preview', [EngineProxyController::class, 'voiceProfilePreview'])
        ->where('id', '[A-Za-z0-9_\-]{1,100}');
});

// ── Guest limits (public — used before login) ─────────────────────────
Route::get('/guest-limits', [GuestLimitsController::class, 'show']);

// ── Plan limits: public read, admin-only write ────────────────────────
Route::get('/plan-limits', [PlanLimitsController::class, 'index']);
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::put('/admin/plan-limits/{plan}', [PlanLimitsController::class, 'update']);

    // AI Engine management
    Route::get(   '/admin/engines',                        [EngineConfigController::class, 'index']);
    Route::post(  '/admin/engines',                        [EngineConfigController::class, 'store']);
    Route::put(   '/admin/engines/{engineConfig}',         [EngineConfigController::class, 'update']);
    Route::delete('/admin/engines/{engineConfig}',         [EngineConfigController::class, 'destroy']);
    Route::post(  '/admin/engines/{engineConfig}/activate',[EngineConfigController::class, 'activate']);
    Route::post(  '/admin/engines/{engineConfig}/test',    [EngineConfigController::class, 'test']);

    // Per-engine platform-wide availability toggles (xtts/f5/chatterbox) —
    // distinct from /admin/engines above, which swaps the entire ai-engine
    // HOST. This controls which individual engines are offered to users.
    Route::get( '/admin/tts-engines',          [TtsEngineSettingsController::class, 'index']);
    Route::put( '/admin/tts-engines/{engine}', [TtsEngineSettingsController::class, 'update']);

    // Activity logs (all users)
    Route::get('/admin/activity-logs', [ActivityLogController::class, 'adminIndex']);

    // Platform stats
    Route::get('/admin/stats', [AdminStatsController::class, 'index']);

    // User management
    Route::get(   '/admin/users',             [AdminUserController::class, 'index']);
    Route::get(   '/admin/users/{user}',      [AdminUserController::class, 'show']);
    Route::put(   '/admin/users/{user}/role', [AdminUserController::class, 'updateRole']);
    Route::delete('/admin/users/{user}',      [AdminUserController::class, 'destroy']);
    Route::post(  '/admin/users/{user}/suspend',     [AdminUserController::class, 'suspend']);
    Route::post(  '/admin/users/{user}/unsuspend',   [AdminUserController::class, 'unsuspend']);
    Route::put(   '/admin/users/{user}/plan',        [AdminUserController::class, 'updatePlanOverride']);
    Route::post(  '/admin/users/{user}/impersonate', [AdminImpersonationController::class, 'start']);
    Route::post(  '/admin/users/{user}/send-reset',          [AdminUserController::class, 'sendPasswordReset']);
    Route::post(  '/admin/users/{user}/resend-verification', [AdminUserController::class, 'resendVerification']);
    Route::put(   '/admin/users/{user}/note',                [AdminUserController::class, 'updateNote']);

    // Reports (all support ?format=csv)
    Route::get('/admin/reports/top-users',      [AdminReportsController::class, 'topUsers']);
    Route::get('/admin/reports/quota-pressure', [AdminReportsController::class, 'quotaPressure']);
    Route::get('/admin/reports/revenue',        [AdminReportsController::class, 'revenue']);
    Route::get('/admin/reports/funnel',         [AdminReportsController::class, 'funnel']);
    Route::get('/admin/reports/engines',        [AdminReportsController::class, 'engines']);
    Route::get('/admin/reports/trends',         [AdminReportsController::class, 'trends']);
    Route::get('/admin/reports/failures',       [AdminReportsController::class, 'failures']);
    Route::get('/admin/reports/abuse',          [AdminReportsController::class, 'abuse']);
    Route::get('/admin/reports/moderation',     [AdminReportsController::class, 'moderation']);
    Route::get('/admin/reports/export/users',   [AdminReportsController::class, 'exportUsers']);

    // Operational settings (API keys, plan IDs, webhooks)
    Route::get('/admin/settings', [AdminSettingsController::class, 'index']);
    Route::put('/admin/settings', [AdminSettingsController::class, 'update']);

    // System health checks (live probes)
    Route::get( '/admin/system-check',            [SystemCheckController::class, 'index']);
    Route::post('/admin/system-check/test-email', [SystemCheckController::class, 'testEmail']);
    Route::post('/admin/system-check/test-alert', [SystemCheckController::class, 'testAlert']);

    // Broadcast announcement email
    Route::post('/admin/broadcast', [AdminBroadcastController::class, 'send']);

    // Subscription management
    Route::get( '/admin/subscriptions',              [AdminSubscriptionController::class, 'index']);
    Route::post('/admin/subscriptions/{id}/cancel',  [AdminSubscriptionController::class, 'cancel']);

    // Admin audit log
    Route::get('/admin/audit-log', [AdminAuditLogController::class, 'index']);
});

// ── Notifications (authenticated) ────────────────────────────────────
Route::middleware('auth:sanctum')->group(function () {
    Route::post('notifications/bulk-synthesis-complete', [NotificationController::class, 'bulkSynthesisComplete']);
});