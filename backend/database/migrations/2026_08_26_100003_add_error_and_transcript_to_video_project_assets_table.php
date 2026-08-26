<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Task #15 (Video Studio) Phase 4 — adds the two columns the
 * extract-audio → transcribe → clone-resynthesize feature needs on top of
 * the Phase 1 schema:
 *
 *   - `error`: failure reason for an 'extracted_audio'/'synthesized_audio'
 *     asset, same role `video_dubbing_jobs.error` already plays for a
 *     dubbing job — kept per-asset rather than reusing DubbingJob's error
 *     column since Phase 4's two background jobs (ExtractAudioAssetJob,
 *     SynthesizeAudioAssetJob) have no DubbingJob row of their own to
 *     write to (see those jobs' own docblocks for why there's no
 *     ActivityLog/job-table layer for this).
 *   - `transcript_json`: the editable segment list
 *     ({id, start, end, original, text}) an 'extracted_audio' asset
 *     carries between ExtractAudioAssetJob populating it and
 *     resynthesize() reading it — same schemaless-JSON-blob choice as
 *     DubbingJob::segments_json, not its own table, for the same reason:
 *     this is read/written as one unit (the whole segment list), never
 *     queried or filtered by individual segment fields.
 *
 * NOTE: this migration is referenced by name in docs/ENHANCEMENT_TASKS.md's
 * Phase 4 write-up (dated Aug 26, 2026) but was missing from the repo —
 * VideoProjectAsset's model already had `error`/`transcript_json` in
 * $fillable/$casts against columns that didn't exist. Added now as part of
 * actually finishing Phase 4, not backdated.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('video_project_assets', function (Blueprint $table) {
            $table->text('error')->nullable()->after('status');
            $table->json('transcript_json')->nullable()->after('error');
        });
    }

    public function down(): void
    {
        Schema::table('video_project_assets', function (Blueprint $table) {
            $table->dropColumn(['error', 'transcript_json']);
        });
    }
};
