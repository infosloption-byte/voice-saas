<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * Add translate_limit + translate_period to plan_limits.
 * Also update plan prices and seed translation quotas:
 *   free:    10/month
 *   starter: 50/month  ($9.99)
 *   pro:     0/month (unlimited)  ($24.99)
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plan_limits', function (Blueprint $table) {
            $table->unsignedInteger('translate_limit')->nullable()->after('synth_period');
            $table->string('translate_period', 10)->nullable()->after('translate_limit');
        });

        DB::table('plan_limits')->where('plan', 'free')->update([
            'translate_limit'  => 10,
            'translate_period' => 'month',
        ]);

        DB::table('plan_limits')->where('plan', 'starter')->update([
            'translate_limit'  => 50,
            'translate_period' => 'month',
        ]);

        DB::table('plan_limits')->where('plan', 'pro')->update([
            'translate_limit'  => 0,   // 0 = unlimited
            'translate_period' => 'month',
        ]);
    }

    public function down(): void
    {
        Schema::table('plan_limits', function (Blueprint $table) {
            $table->dropColumn(['translate_limit', 'translate_period']);
        });
    }
};
