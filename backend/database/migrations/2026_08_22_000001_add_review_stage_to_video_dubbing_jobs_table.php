<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Splits the previously-atomic dubbing pipeline into two phases so the
 * user can review/edit segment timing and translated text on a real
 * timeline (drag to retime, resize to change duration, edit text, undo/
 * redo) before committing to synthesis + mux:
 *
 *   PrepareDubbingJob  — extract, transcribe, translate → stores
 *                        segments_json, stops at 'ready_for_review'
 *   FinalizeDubbingJob — reads segments_json (possibly edited by the
 *                        user), synthesizes + splices + muxes, same as
 *                        the back half of the original VideoDubbingJob
 *
 * segments_json holds an array of {id, start, end, original, text} — see
 * VideoDubbingController::segments()/updateSegments(). MySQL enums can't
 * be altered with a simple addColumn, hence the raw MODIFY COLUMN below.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('video_dubbing_jobs', function (Blueprint $table) {
            $table->longText('segments_json')->nullable()->after('segment_overflow_count');
        });

        DB::statement("ALTER TABLE video_dubbing_jobs MODIFY status ENUM(
            'queued', 'transcribing', 'translating', 'ready_for_review',
            'synthesizing', 'muxing', 'done', 'failed'
        ) NOT NULL DEFAULT 'queued'");
    }

    public function down(): void
    {
        // Any row currently sitting in 'ready_for_review' has no
        // equivalent in the old enum — bump it back to 'translating' so
        // the column narrows cleanly rather than truncating to ''.
        DB::table('video_dubbing_jobs')->where('status', 'ready_for_review')->update(['status' => 'translating']);

        DB::statement("ALTER TABLE video_dubbing_jobs MODIFY status ENUM(
            'queued', 'transcribing', 'translating',
            'synthesizing', 'muxing', 'done', 'failed'
        ) NOT NULL DEFAULT 'queued'");

        Schema::table('video_dubbing_jobs', function (Blueprint $table) {
            $table->dropColumn('segments_json');
        });
    }
};
