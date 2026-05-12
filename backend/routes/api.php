<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

use App\Http\Controllers\AuthController;

Route::post('/register', [AuthController::class, 'register']);
Route::post('/login', [AuthController::class, 'login']);
Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user', function (Request $request) {
        return $request->user();
    });

    Route::apiResource('projects', \App\Http\Controllers\ProjectController::class);
    Route::post('projects/{project}/scripts/reorder', [\App\Http\Controllers\ScriptController::class, 'reorder']);
    Route::apiResource('projects.scripts', \App\Http\Controllers\ScriptController::class)->scoped([
        'script' => 'id',
        'project' => 'id'
    ]);
    
    Route::apiResource('voice-profiles', \App\Http\Controllers\VoiceProfileController::class);
});
