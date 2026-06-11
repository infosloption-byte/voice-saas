<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('role', 20)->default('user')->after('email_verified_at');
            $table->index('role');
        });

        // Promote the ADMIN_EMAIL user to super_admin on first deploy
        $adminEmail = config('app.admin_email', '');
        if ($adminEmail) {
            \App\Models\User::where('email', $adminEmail)->update(['role' => 'super_admin']);
        }
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('role');
        });
    }
};
