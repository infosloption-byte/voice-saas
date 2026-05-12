<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\ScriptController;
use App\Http\Controllers\VoiceProfileController;

// ── Public auth routes ────────────────────────────────────────────────
Route::post('/register', [AuthController::class, 'register']);
Route::post('/login',    [AuthController::class, 'login']);
Route::post('/logout',   [AuthController::class, 'logout'])->middleware('auth:sanctum');

// ── Authenticated routes ──────────────────────────────────────────────
Route::middleware('auth:sanctum')->group(function () {

    // Current user
    Route::get('/user', fn (Request $request) => $request->user());

    // Projects
    Route::apiResource('projects', ProjectController::class);

    Route::post('scripts/update', [ScriptController::class, 'flatUpdate']);

    // Scripts (nested under projects)
    Route::post(
        'projects/{project}/scripts/reorder',
        [ScriptController::class, 'reorder']
    );
    Route::apiResource('projects.scripts', ScriptController::class)->scoped([
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