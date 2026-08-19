<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * TTS engine platform-wide availability toggles — separate from the
 * `engine_configs` table (which swaps the entire ai-engine HOST the
 * backend talks to). This table controls which individual TTS engines
 * (xtts / f5 / chatterbox) admins want OFFERED to users at all,
 * independent of whether each is technically reachable right now.
 * EngineCapabilitiesController combines both signals before reporting
 * availability to the frontend: an engine only shows as usable if it's
 * BOTH admin-enabled here AND actually reachable per ai-engine's own
 * status.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tts_engine_settings', function (Blueprint $table) {
            $table->id();
            $table->string('engine', 40)->unique();   // 'xtts' | 'f5' | 'chatterbox'
            $table->boolean('enabled')->default(true);
            $table->timestamps();
        });

        // Seed the 3 known engines, all enabled by default — matches the
        // existing behavior (no admin gate) so this migration is non-breaking.
        // Keep in sync with EngineResolver::SUPPORTED_TTS_ENGINES.
        $now = now();
        DB::table('tts_engine_settings')->insert([
            ['engine' => 'xtts',       'enabled' => true, 'created_at' => $now, 'updated_at' => $now],
            ['engine' => 'f5',         'enabled' => true, 'created_at' => $now, 'updated_at' => $now],
            ['engine' => 'chatterbox', 'enabled' => true, 'created_at' => $now, 'updated_at' => $now],
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('tts_engine_settings');
    }
};
