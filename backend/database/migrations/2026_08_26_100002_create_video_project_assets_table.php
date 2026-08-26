<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Task #15 (Video Studio) Phase 1 — a project's media bin. Named
 * `video_project_assets`, not `video_project_clips` like task #6a's
 * (deleted) equivalent, because a bin entry isn't always a video clip
 * anymore: Phase 2 adds images and standalone audio, and Phase 4 adds
 * audio assets that were extracted/synthesized rather than uploaded —
 * `kind`/`source` below exist to carry that from day one instead of
 * bolting it on later like 6a would have had to.
 *
 * Only `kind = 'video'` rows are actually created by Phase 1 (this
 * migration ships alongside VideoProjectController::submit()-side wiring
 * on VideoDubbingController, not a general addAsset() upload endpoint yet
 * — that's Phase 2). The schema is deliberately already shaped for the
 * later phases so Phase 2/4 don't need their own migration for columns
 * that were foreseeable now.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('video_project_assets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('video_project_id')->constrained('video_projects')->cascadeOnDelete();

            $table->enum('kind', ['video', 'image', 'audio']);

            // upload: user picked a file (Phase 1: video only; Phase 2: + image/audio).
            // dubbed: produced by VideoProjectController::dubClip() (Phase 3).
            // extracted_audio / synthesized_audio: produced by the
            // extract->transcribe->resynthesize pipeline (Phase 4).
            $table->enum('source', ['upload', 'dubbed', 'extracted_audio', 'synthesized_audio'])->default('upload');

            // Self-referencing: a dubbed video's parent is its source video;
            // a synthesized audio clip's parent is the extracted-audio asset
            // it came from. Nullable — plain uploads have no parent.
            $table->uuid('parent_asset_id')->nullable();
            $table->foreign('parent_asset_id')->references('id')->on('video_project_assets')->nullOnDelete();

            // Set when this asset is (or is backed by) a dubbing job — Phase 1
            // sets this immediately for every video upload (today's
            // upload-and-dub-in-one-step flow, unchanged from pre-Video-Studio
            // behavior); Phase 3 adds the "dub an existing bin asset later"
            // path that also fills this in once the user chooses to dub it.
            $table->uuid('dubbing_job_id')->nullable();
            $table->foreign('dubbing_job_id')->references('id')->on('video_dubbing_jobs')->nullOnDelete();

            $table->string('original_filename', 255)->nullable();
            // Nullable: a 'dubbed' asset has no file of its own until its
            // dubbing job finishes — its ready-ness is read through
            // dubbing_job_id in the meantime, same 410-on-missing-file
            // pattern the video:prune command relies on (see task #6 notes).
            $table->string('storage_path', 500)->nullable();
            $table->decimal('duration_seconds', 8, 2)->nullable(); // null for images

            $table->enum('status', ['processing', 'ready', 'failed'])->default('ready');

            $table->timestamps();

            $table->index(['video_project_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('video_project_assets');
    }
};
