<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('voice_profiles', 'engine_key')) {
            Schema::table('voice_profiles', function (Blueprint $table) {
                $table->string('engine_key', 36)->nullable()->unique()->after('profile_id');
            });
        }

        // Backfill existing rows — existing .wav files will be orphaned on the engine
        // until the user re-records; this is acceptable for a dev environment.
        \DB::table('voice_profiles')->orderBy('id')->each(function ($row) {
            \DB::table('voice_profiles')
                ->where('id', $row->id)
                ->update(['engine_key' => (string) Str::uuid()]);
        });
    }

    public function down(): void
    {
        Schema::table('voice_profiles', function (Blueprint $table) {
            $table->dropUnique(['engine_key']);
            $table->dropColumn('engine_key');
        });
    }
};
