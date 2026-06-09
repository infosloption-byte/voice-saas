<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('engine_configs', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('url');
            $table->boolean('is_active')->default(false);
            $table->string('status')->default('unknown'); // unknown|online|offline
            $table->integer('latency_ms')->nullable();
            $table->timestamp('last_tested_at')->nullable();
            $table->timestamps();
        });

        // Seed the default local engine as active
        DB::table('engine_configs')->insert([
            'name'       => 'Local Server',
            'url'        => env('AI_ENGINE_URL', 'http://ai-engine:8000'),
            'is_active'  => true,
            'status'     => 'unknown',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('engine_configs');
    }
};
