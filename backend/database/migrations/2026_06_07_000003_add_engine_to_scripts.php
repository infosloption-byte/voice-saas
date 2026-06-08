<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Record which TTS engine ("xtts" | "f5") produced a script's audio, so the
 *  choice persists server-side instead of only in browser localStorage. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('scripts', function (Blueprint $table) {
            $table->string('engine', 10)->default('xtts')->after('tone');
        });
    }

    public function down(): void
    {
        Schema::table('scripts', function (Blueprint $table) {
            $table->dropColumn('engine');
        });
    }
};
