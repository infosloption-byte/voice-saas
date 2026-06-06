<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Add advanced_params JSON column to scripts for custom XTTS temperature/top_k/top_p overrides. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('scripts', function (Blueprint $table) {
            $table->json('advanced_params')->nullable()->after('waveform_peaks');
        });
    }

    public function down(): void
    {
        Schema::table('scripts', function (Blueprint $table) {
            $table->dropColumn('advanced_params');
        });
    }
};
