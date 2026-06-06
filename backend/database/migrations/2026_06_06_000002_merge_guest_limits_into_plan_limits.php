<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Consolidate the separate guest_limits table into plan_limits by treating
 * "guest" as just another tier. Guest-specific columns (synth/preview/script
 * session limits) are added to plan_limits; paid-plan rows leave them NULL.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1. Add guest-specific columns (NULL = not applicable to that plan)
        Schema::table('plan_limits', function (Blueprint $table) {
            $table->unsignedInteger('synth_limit')->nullable()->after('word_limit');
            $table->unsignedInteger('preview_limit')->nullable()->after('synth_limit');
            $table->unsignedInteger('script_limit')->nullable()->after('preview_limit');
            $table->unsignedInteger('session_days')->nullable()->after('script_limit');
        });

        // 2. Copy the existing guest_limits config into a new 'guest' row.
        //    Fall back to the historical defaults if the table/row is missing.
        $guest = Schema::hasTable('guest_limits')
            ? DB::table('guest_limits')->first()
            : null;

        DB::table('plan_limits')->updateOrInsert(
            ['plan' => 'guest'],
            [
                // Shared columns guests actually use
                'profile_limit' => $guest->profile_limit ?? 2,
                'word_limit'    => $guest->word_limit    ?? 100,
                // Guest-specific columns
                'synth_limit'   => $guest->synth_limit   ?? 1,
                'preview_limit' => $guest->preview_limit ?? 2,
                'script_limit'  => $guest->script_limit  ?? 3,
                'session_days'  => $guest->session_days  ?? 7,
                // Columns that don't apply to guests
                'project_limit' => 1,
                'multi_voice'   => false,
                'data_export'   => false,
                'created_at'    => now(),
                'updated_at'    => now(),
            ]
        );

        // 3. Drop the now-redundant guest_limits table
        Schema::dropIfExists('guest_limits');
    }

    public function down(): void
    {
        // Recreate guest_limits and restore its row from the plan_limits guest row
        Schema::create('guest_limits', function (Blueprint $table) {
            $table->id();
            $table->unsignedSmallInteger('synth_limit')->default(1);
            $table->unsignedSmallInteger('word_limit')->default(100);
            $table->unsignedSmallInteger('preview_limit')->default(2);
            $table->unsignedSmallInteger('script_limit')->default(3);
            $table->unsignedSmallInteger('profile_limit')->default(2);
            $table->unsignedSmallInteger('session_days')->default(7);
            $table->timestamps();
        });

        $guest = DB::table('plan_limits')->where('plan', 'guest')->first();
        DB::table('guest_limits')->insert([
            'synth_limit'   => $guest->synth_limit   ?? 1,
            'word_limit'    => $guest->word_limit    ?? 100,
            'preview_limit' => $guest->preview_limit ?? 2,
            'script_limit'  => $guest->script_limit  ?? 3,
            'profile_limit' => $guest->profile_limit ?? 2,
            'session_days'  => $guest->session_days  ?? 7,
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        DB::table('plan_limits')->where('plan', 'guest')->delete();

        Schema::table('plan_limits', function (Blueprint $table) {
            $table->dropColumn(['synth_limit', 'preview_limit', 'script_limit', 'session_days']);
        });
    }
};
