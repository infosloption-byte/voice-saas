<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plan_limits', function (Blueprint $table) {
            $table->id();
            $table->string('plan', 20)->unique(); // 'free' | 'starter' | 'pro'

            // Numeric count limits (use 0 to mean "unlimited")
            $table->unsignedInteger('project_limit')->default(1);
            $table->unsignedInteger('profile_limit')->default(1);
            $table->unsignedInteger('word_limit')->default(500);

            // Boolean feature flags
            $table->boolean('multi_voice')->default(false);
            $table->boolean('data_export')->default(false);

            $table->timestamps();
        });

        // Seed one row per plan with the values advertised on the pricing page.
        // 0 in project_limit / profile_limit / word_limit means "unlimited".
        $now = now();
        \DB::table('plan_limits')->insert([
            [
                'plan'          => 'free',
                'project_limit' => 1,
                'profile_limit' => 1,
                'word_limit'    => 500,
                'multi_voice'   => false,
                'data_export'   => false,
                'created_at'    => $now,
                'updated_at'    => $now,
            ],
            [
                'plan'          => 'starter',
                'project_limit' => 10,
                'profile_limit' => 5,
                'word_limit'    => 5000,
                'multi_voice'   => true,
                'data_export'   => false,
                'created_at'    => $now,
                'updated_at'    => $now,
            ],
            [
                'plan'          => 'pro',
                'project_limit' => 0,   // 0 = unlimited
                'profile_limit' => 0,
                'word_limit'    => 0,
                'multi_voice'   => true,
                'data_export'   => true,
                'created_at'    => $now,
                'updated_at'    => $now,
            ],
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('plan_limits');
    }
};
