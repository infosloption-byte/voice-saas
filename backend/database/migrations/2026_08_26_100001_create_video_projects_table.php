<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Task #15 (Video Studio) Phase 1 — a project is the container the new
 * Video Studio's media bin/timeline hang off of. Deliberately a fresh
 * design, not a restore of task #6a's deleted migration of the same name:
 * 6a's `timeline_json` was a flat ordered sequence (single lane, no real
 * positioning); this one is planned from the start to hold Phase 5's
 * multi-lane shape (see docs/ENHANCEMENT_TASKS.md task #15, Phase 5) —
 * `{ id, asset_id, lane, start_time, trim_in, trim_out, kind }[]` — even
 * though nothing writes anything but an empty array to it until Phase 5
 * actually ships. Kept nullable/schemaless (json cast, not per-field
 * columns) for the same reason DubbingJob keeps `segments_json` schemaless:
 * the shape is still expected to evolve across phases 3-5 and a migration
 * per tweak would be worse than one cast column now.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('video_projects', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            $table->string('name', 255)->default('Untitled project');

            // draft: no render yet / edits still happening.
            // rendering/done/failed: set by the Phase 6 render job — this
            // column exists now so Phase 6 doesn't need its own migration.
            $table->enum('status', ['draft', 'rendering', 'done', 'failed'])->default('draft');
            $table->text('error')->nullable();

            $table->json('timeline_json')->nullable();

            // Rendered output — same disk/path shape as DubbingJob's
            // result_video_path, set once Phase 6 actually renders.
            $table->string('output_video_path', 500)->nullable();
            $table->decimal('duration_seconds', 8, 2)->nullable();

            $table->timestamps();

            $table->index(['user_id', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('video_projects');
    }
};
