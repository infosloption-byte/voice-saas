<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Admin\EngineConfigController;
use App\Http\Controllers\ActivityLogController;
use App\Http\Controllers\EngineCapabilitiesController;
use App\Http\Controllers\EngineProxyController;
use App\Http\Controllers\EngineSynthesisProxyController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\EmailVerificationController;
use App\Http\Controllers\GuestLimitsController;
use App\Http\Controllers\PlanLimitsController;
use App\Http\Controllers\PasswordResetController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\ScriptController;
use App\Http\Controllers\SubscriptionController;
use App\Http\Controllers\SynthesisUsageController;
use App\Http\Controllers\TranslationUsageController;
use App\Http\Controllers\VoiceProfileController;

// ── Public auth routes ────────────────────────────────────────────────
Route::middleware('throttle:5,1')->group(function () {
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/login',    [AuthController::class, 'login']);
});
Route::post('/logout',   [AuthController::class, 'logout'])->middleware('auth:sanctum');

// ── Authenticated routes ──────────────────────────────────────────────
Route::middleware('auth:sanctum')->group(function () {

    // Current user
    Route::get('/user',          fn (Request $request) => $request->user());
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
    Route::get(   'activity-logs',      [ActivityLogController::class, 'index']);
    Route::post(  'activity-logs',      [ActivityLogController::class, 'store']);
    Route::match(['put', 'patch'], 'activity-logs/{activityLog}', [ActivityLogController::class, 'update']);
    Route::delete('activity-logs',      [ActivityLogController::class, 'destroy']);

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

    // Activity logs (all users)
    Route::get('/admin/activity-logs', [ActivityLogController::class, 'adminIndex']);
});