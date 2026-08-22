<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dubbing jobs never recorded which TTS engine to use — VideoDubbingJob
 * hardcoded 'xtts' for every segment regardless of which engine server was
 * actually active (see EngineResolver::activeUrl(), which swaps HOSTS, not
 * models). If an admin had F5 or Chatterbox toggled active, dubbing jobs
 * were silently sending tts_engine=xtts to a host that may not be running
 * that model at all. This column lets the frontend pass the same
 * TTSEngine choice (see useTTSEngine.ts) already used for scripts/bulk
 * synthesis, nullable so existing/omitted jobs fall back to the platform
 * default in VideoDubbingJob rather than breaking validation.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('video_dubbing_jobs', function (Blueprint $table) {
            $table->string('engine', 40)->nullable()->after('voice_profile_id');
        });
    }

    public function down(): void
    {
        Schema::table('video_dubbing_jobs', function (Blueprint $table) {
            $table->dropColumn('engine');
        });
    }
};
