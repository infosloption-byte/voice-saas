<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Track per-user AI translation counts per time window (mirrors synthesis_usage). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('translation_usage', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('period_type', 10);  // 'month'
            $table->string('period_key',  10);  // '2026-06'
            $table->unsignedInteger('count')->default(0);
            $table->timestamps();

            $table->unique(['user_id', 'period_type', 'period_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('translation_usage');
    }
};
