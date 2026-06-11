<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Soft, reversible account suspension (admin action)
            $table->timestamp('suspended_at')->nullable()->after('role');
            // Admin-granted plan override ('starter'|'pro') — wins over the
            // PayPal subscription when resolving the effective plan
            $table->string('plan_override', 20)->nullable()->after('suspended_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['suspended_at', 'plan_override']);
        });
    }
};
