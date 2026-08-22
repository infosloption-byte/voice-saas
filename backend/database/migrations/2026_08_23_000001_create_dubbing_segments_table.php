<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Task #6 follow-up — "advanced dubbing" Tier 1 (see docs/ENHANCEMENT_TASKS.md).
 *
 * VideoDubbingJob previously transcribed, translated, and synthesized every
 * segment entirely in memory during one job run, then discarded all of it
 * except a bare segment_count on video_dubbing_jobs. That made it
 * impossible to review what was actually said/translated per line, fix a
 * mistranslated segment without re-dubbing the whole video, mute a segment,
 * or assign a different voice to one speaker — the core asks behind
 * "advanced mode" for dubbing.
 *
 * This table gives each segment a durable row: its own timing, original +
 * translated text, an optional per-segment voice override, a mute flag,
 * the fit/status outcome VideoDubbingJob already computed (ok/overflow/
 * empty/synth_failed), and its own individually-stored audio file so it
 * can be replayed, edited, and re-synthesized independently, then folded
 * back into a full remux without re-running transcription/translation/
 * synthesis for the whole video.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dubbing_segments', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('dubbing_job_id')
                ->constrained('video_dubbing_jobs')->cascadeOnDelete();

            $table->unsignedInteger('segment_index'); // 0-based order within the job
            $table->decimal('start_time', 8, 3);
            $table->decimal('end_time', 8, 3);

            $table->text('original_text');
            $table->text('translated_text');

            // Null = inherit the parent job's voice. Set = this specific
            // segment was assigned a different cloned voice (e.g. a
            // second speaker), independent of the job's default.
            $table->string('voice_profile_id', 100)->nullable();

            // Deliberate user action ("skip dubbing this line, keep it
            // silent") — orthogonal to `status` below, which instead
            // reflects what VideoDubbingJob's own fit/synthesis logic did.
            $table->boolean('muted')->default(false);

            $table->enum('status', ['ok', 'overflow', 'empty', 'synth_failed'])
                ->default('ok');
            $table->decimal('stretch_ratio', 6, 3)->nullable();

            // This segment's own fitted audio, on the 'video' disk —
            // independent of the job's combined result_video_path, so one
            // segment can be replayed/edited/re-synthesized on its own.
            $table->string('audio_path', 500)->nullable();

            $table->timestamps();

            $table->unique(['dubbing_job_id', 'segment_index']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dubbing_segments');
    }
};
