<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Make the guest tier inherit Free's shared feature limits.
 *
 * The guest row keeps only its session-specific knobs (synth_limit,
 * preview_limit, script_limit, session_days). Its shared columns
 * (project_limit, profile_limit, word_limit) are set to NULL so the
 * PlanLimits service falls back to the 'free' row for those values.
 *
 * This gives a single source of truth for "non-paying user limits" (the
 * free row) while still allowing guests to be made stricter later by
 * filling in the guest columns again.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Shared columns must allow NULL so guest can defer to the free row.
        Schema::table('plan_limits', function (Blueprint $table) {
            $table->unsignedInteger('project_limit')->nullable()->default(1)->change();
            $table->unsignedInteger('profile_limit')->nullable()->default(1)->change();
            $table->unsignedInteger('word_limit')->nullable()->default(500)->change();
        });

        DB::table('plan_limits')->where('plan', 'guest')->update([
            'project_limit' => null,
            'profile_limit' => null,
            'word_limit'    => null,
            'updated_at'    => now(),
        ]);
    }

    public function down(): void
    {
        // Restore the standalone guest values that were seeded originally.
        DB::table('plan_limits')->where('plan', 'guest')->update([
            'project_limit' => 1,
            'profile_limit' => 2,
            'word_limit'    => 100,
            'updated_at'    => now(),
        ]);

        Schema::table('plan_limits', function (Blueprint $table) {
            $table->unsignedInteger('project_limit')->nullable(false)->default(1)->change();
            $table->unsignedInteger('profile_limit')->nullable(false)->default(1)->change();
            $table->unsignedInteger('word_limit')->nullable(false)->default(500)->change();
        });
    }
};
