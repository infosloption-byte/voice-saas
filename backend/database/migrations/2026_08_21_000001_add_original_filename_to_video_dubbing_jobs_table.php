<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Video dubbing workspace: the job list needs something better to show
 * users than a bare UUID, so we capture the uploaded file's original name.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('video_dubbing_jobs', function (Blueprint $table) {
            $table->string('original_filename', 255)->nullable()->after('target_language');
        });
    }

    public function down(): void
    {
        Schema::table('video_dubbing_jobs', function (Blueprint $table) {
            $table->dropColumn('original_filename');
        });
    }
};
