<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Task #15 (Video Studio) Phase 4 follow-up — closes the gap the Phase 4
 * write-up flagged and deliberately left open: "the extracted-audio
 * asset's detected source language isn't persisted anywhere (Whisper
 * returns it, but nothing stores it)."
 *
 * Only ever set on an 'extracted_audio' asset, by ExtractAudioAssetJob,
 * from the `language` field ai-engine's /transcribe/segments response
 * already returns (see main.py's transcribe_segments — it was already
 * being computed and discarded). resynthesize() reads it to pre-fill its
 * `language` param default instead of the previous hardcoded 'en'.
 *
 * String, not an enum: Whisper's detected codes aren't guaranteed to be a
 * subset of this app's own LANGUAGES list (see frontend/src/lib/
 * constants.tsx) — a code outside that list is still worth storing/
 * showing to the user, even if the language <select> itself falls back to
 * 'en' when the detected code isn't one of its options.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('video_project_assets', function (Blueprint $table) {
            $table->string('detected_language', 10)->nullable()->after('transcript_json');
        });
    }

    public function down(): void
    {
        Schema::table('video_project_assets', function (Blueprint $table) {
            $table->dropColumn('detected_language');
        });
    }
};
