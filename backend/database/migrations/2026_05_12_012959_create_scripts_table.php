<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('scripts', function (Blueprint $table) {
            $table->string('id', 50)->primary();
            $table->string('project_id', 50);
            $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
            $table->string('title');
            $table->text('content')->nullable();
            $table->boolean('has_audio')->default(false);
            $table->string('profile_id')->nullable();
            $table->string('language')->default('en');
            $table->float('duration')->nullable();
            $table->float('speed')->default(1.0);
            $table->json('waveform_peaks')->nullable();
            $table->integer('order_index')->default(0);
            $table->string('audio_url')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('scripts');
    }
};
