<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Align plan_limits with the Voxora cost report (June 2026).
 *
 * Report plan structure:
 *   Free     – $0      – 20 synths/mo   – 1 voice profile
 *   Starter  – $9/mo   – 150 synths/mo  – 3 voice profiles
 *   Creator  – $29/mo  – 600 synths/mo  – 10 voice profiles  ← NEW
 *   Pro      – $79/mo  – 2,000 synths/mo – 25 voice profiles
 *
 * Changes vs the previous schema:
 *   - free:    synth_limit 3/day → 20/month
 *   - starter: synth_limit 100/mo → 150/mo, profile_limit 5 → 3
 *   - creator: INSERT new row
 *   - pro:     profile_limit unlimited → 25, synth_limit 0 → 2000/mo
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        // ── Free: 3/day → 20/month ────────────────────────────────
        DB::table('plan_limits')->where('plan', 'free')->update([
            'synth_limit'   => 20,
            'synth_period'  => 'month',
            'profile_limit' => 1,
            'updated_at'    => $now,
        ]);

        // ── Starter: 100/mo → 150/mo, profiles 5 → 3 ─────────────
        DB::table('plan_limits')->where('plan', 'starter')->update([
            'synth_limit'   => 150,
            'synth_period'  => 'month',
            'profile_limit' => 3,
            'project_limit' => 10,
            'word_limit'    => 5000,
            'updated_at'    => $now,
        ]);

        // ── Creator: INSERT (new tier) ────────────────────────────
        // Only insert if not already present (idempotent).
        if (DB::table('plan_limits')->where('plan', 'creator')->doesntExist()) {
            DB::table('plan_limits')->insert([
                'plan'             => 'creator',
                'project_limit'    => 0,      // unlimited projects
                'profile_limit'    => 10,
                'word_limit'       => 0,      // unlimited words per script
                'multi_voice'      => true,
                'data_export'      => false,
                'synth_limit'      => 600,
                'synth_period'     => 'month',
                'translate_limit'  => 200,
                'translate_period' => 'month',
                'created_at'       => $now,
                'updated_at'       => $now,
            ]);
        }

        // ── Pro: profile_limit 0 → 25, synth_limit 0 → 2000 ─────
        // The cost report caps Pro at 2,000 synths/mo and 25 profiles.
        // Pro remains the only plan with data_export = true.
        DB::table('plan_limits')->where('plan', 'pro')->update([
            'synth_limit'      => 2000,
            'synth_period'     => 'month',
            'profile_limit'    => 25,
            'translate_limit'  => 0,     // unlimited translations
            'data_export'      => true,
            'updated_at'       => $now,
        ]);
    }

    public function down(): void
    {
        $now = now();

        // Remove creator plan
        DB::table('plan_limits')->where('plan', 'creator')->delete();

        // Restore free to 3/day
        DB::table('plan_limits')->where('plan', 'free')->update([
            'synth_limit'   => 3,
            'synth_period'  => 'day',
            'updated_at'    => $now,
        ]);

        // Restore starter
        DB::table('plan_limits')->where('plan', 'starter')->update([
            'synth_limit'   => 100,
            'synth_period'  => 'month',
            'profile_limit' => 5,
            'updated_at'    => $now,
        ]);

        // Restore pro to unlimited
        DB::table('plan_limits')->where('plan', 'pro')->update([
            'synth_limit'   => 0,
            'profile_limit' => 0,
            'updated_at'    => $now,
        ]);
    }
};