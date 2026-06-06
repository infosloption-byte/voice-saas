<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Track per-user synthesis counts per time window.
 *
 * period_type: 'day' | 'month'
 * period_key:  '2026-06-06' for day, '2026-06' for month
 * count:       number of syntheses in this window
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('synthesis_usage', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('period_type', 10);  // 'day' | 'month'
            $table->string('period_key',  10);  // '2026-06-06' | '2026-06'
            $table->unsignedInteger('count')->default(0);
            $table->timestamps();

            $table->unique(['user_id', 'period_type', 'period_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('synthesis_usage');
    }
};
