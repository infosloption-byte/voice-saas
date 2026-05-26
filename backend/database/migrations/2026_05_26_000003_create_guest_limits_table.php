<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
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

        // Seed the single config row with defaults
        \DB::table('guest_limits')->insert([
            'synth_limit'   => 1,
            'word_limit'    => 100,
            'preview_limit' => 2,
            'script_limit'  => 3,
            'profile_limit' => 2,
            'session_days'  => 7,
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('guest_limits');
    }
};
