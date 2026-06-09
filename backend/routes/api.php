<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Admin\EngineConfigController;
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

    // Voice profiles
    // GET  /api/voice-profiles        → list user's profiles
    // POST /api/voice-profiles        → save profile (with optional audio file forwarded to engine)
    // DELETE /api/voice-profiles/{id} → delete profile
    Route::get(   'voice-profiles',      [VoiceProfileController::class, 'index']);
    Route::post(  'voice-profiles',      [VoiceProfileController::class, 'store']);
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
});