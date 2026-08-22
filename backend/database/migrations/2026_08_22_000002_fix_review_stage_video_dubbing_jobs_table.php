<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Corrective follow-up to 2026_08_22_000001_add_review_stage_to_video_
 * dubbing_jobs_table.php — that migration was already recorded as run on
 * this server with content that has since changed locally, and Laravel
 * only tracks migrations by filename, not by content hash, so
 * `php artisan migrate` alone won't re-apply the edited version (and a
 * blind rollback would risk dropping segments_json/status data for any
 * job already sitting in ready_for_review on this server).
 *
 * Deliberately idempotent instead of assuming a known prior state:
 * checks the live schema before touching anything, so this is safe to
 * run whether the original migration got fully applied, partially
 * applied, or applied with the exact intended content — it converges to
 * the same end state either way rather than erroring on an "already
 * exists" collision.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('video_dubbing_jobs', 'segments_json')) {
            Schema::table('video_dubbing_jobs', function (Blueprint $table) {
                $table->longText('segments_json')->nullable()->after('segment_overflow_count');
            });
        }

        if (! $this->statusEnumHas('ready_for_review')) {
            DB::statement("ALTER TABLE video_dubbing_jobs MODIFY status ENUM(
                'queued', 'transcribing', 'translating', 'ready_for_review',
                'synthesizing', 'muxing', 'done', 'failed'
            ) NOT NULL DEFAULT 'queued'");
        }
    }

    public function down(): void
    {
        DB::table('video_dubbing_jobs')->where('status', 'ready_for_review')->update(['status' => 'translating']);

        DB::statement("ALTER TABLE video_dubbing_jobs MODIFY status ENUM(
            'queued', 'transcribing', 'translating',
            'synthesizing', 'muxing', 'done', 'failed'
        ) NOT NULL DEFAULT 'queued'");

        if (Schema::hasColumn('video_dubbing_jobs', 'segments_json')) {
            Schema::table('video_dubbing_jobs', function (Blueprint $table) {
                $table->dropColumn('segments_json');
            });
        }
    }

    /** True if the given value is already one of the status column's ENUM options, checked against information_schema rather than assumed. */
    private function statusEnumHas(string $value): bool
    {
        $row = DB::selectOne(
            "SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'video_dubbing_jobs' AND COLUMN_NAME = 'status'"
        );
        if (! $row) {
            return false;
        }
        // COLUMN_TYPE looks like: enum('queued','transcribing',...)
        return str_contains($row->type, "'{$value}'");
    }
};
