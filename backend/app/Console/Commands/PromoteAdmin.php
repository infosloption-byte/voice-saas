<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * Promote (or demote) a user by email. Useful for bootstrapping the first
 * super admin and recovering access if roles get into a bad state.
 *
 *   php artisan admin:promote chathu.ad@gmail.com
 *   php artisan admin:promote someone@example.com --role=admin
 *   php artisan admin:promote someone@example.com --role=user
 */
class PromoteAdmin extends Command
{
    protected $signature = 'admin:promote
                            {email : Email of the user to change}
                            {--role=super_admin : Role to assign (user, admin, super_admin)}';

    protected $description = 'Assign a role to a user by email';

    public function handle(): int
    {
        $email = $this->argument('email');
        $role  = $this->option('role');

        if (! in_array($role, ['user', 'admin', 'super_admin'], true)) {
            $this->error("Invalid role '{$role}'. Use: user, admin, super_admin");
            return self::FAILURE;
        }

        $user = User::where('email', $email)->first();
        if (! $user) {
            $this->error("No user found with email {$email}");
            return self::FAILURE;
        }

        $before = $user->role ?? 'user';
        $user->update(['role' => $role]);

        $this->info("{$email}: {$before} → {$role}");
        return self::SUCCESS;
    }
}
