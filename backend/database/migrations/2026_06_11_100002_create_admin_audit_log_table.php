<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('admin_audit_log', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('actor_id')->nullable(); // admin who took the action
            $table->unsignedBigInteger('target_user_id')->nullable();
            $table->string('action', 80);         // e.g. role.changed, user.suspended
            $table->string('before_value', 255)->nullable();
            $table->string('after_value', 255)->nullable();
            $table->string('ip', 45)->nullable();
            $table->text('note')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['actor_id', 'created_at']);
            $table->index('target_user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_audit_log');
    }
};
