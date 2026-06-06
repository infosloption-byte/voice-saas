<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Extend plan_limits with synthesis quota tracking for authenticated tiers.
 *
 * The synth_limit column already exists (added in migration 000002 for guest
 * session knobs). We add synth_period ('day'|'month') and seed quota values
 * for the paid tiers — free=3/day, starter=100/month, pro=0 (unlimited).
 *
 * Guest row keeps its existing synth_limit (1 per session) but does not use
 * synth_period — guest quota is managed client-side via localStorage.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plan_limits', function (Blueprint $table) {
            $table->string('synth_period', 10)->nullable()->default(null)->after('synth_limit');
        });

        DB::table('plan_limits')->where('plan', 'free')->update([
            'synth_limit'  => 3,
            'synth_period' => 'day',
            'updated_at'   => now(),
        ]);
        DB::table('plan_limits')->where('plan', 'starter')->update([
            'synth_limit'  => 100,
            'synth_period' => 'month',
            'updated_at'   => now(),
        ]);
        DB::table('plan_limits')->where('plan', 'pro')->update([
            'synth_limit'  => 0,
            'synth_period' => 'month',
            'updated_at'   => now(),
        ]);
    }

    public function down(): void
    {
        Schema::table('plan_limits', function (Blueprint $table) {
            $table->dropColumn('synth_period');
        });

        DB::table('plan_limits')->whereIn('plan', ['free', 'starter', 'pro'])->update([
            'synth_limit'  => null,
            'updated_at'   => now(),
        ]);
    }
};
