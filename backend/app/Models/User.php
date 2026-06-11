<?php

namespace App\Models;

use App\Notifications\ResetPasswordNotification;
use App\Notifications\VerifyEmailNotification;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'password', 'bio', 'role'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable implements MustVerifyEmail
{
    protected $appends = ['plan_name', 'is_admin'];

    protected $with = ['subscription'];

    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    /** Use Voxora-branded email verification notification. */
    public function sendEmailVerificationNotification(): void
    {
        $this->notify(new VerifyEmailNotification());
    }

    /** Use Voxora-branded password reset notification. */
    public function sendPasswordResetNotification($token): void
    {
        $this->notify(new ResetPasswordNotification($token));
    }

    public function projects()
    {
        return $this->hasMany(Project::class);
    }

    public function voiceProfiles()
    {
        return $this->hasMany(VoiceProfile::class);
    }

    public function subscription()
    {
        return $this->hasOne(Subscription::class);
    }

    public function getIsAdminAttribute(): bool
    {
        // Role-based (post-migration) or legacy ADMIN_EMAIL fallback
        if (in_array($this->role ?? 'user', ['admin', 'super_admin'], true)) {
            return true;
        }
        $adminEmail = config('app.admin_email', '');
        return $adminEmail && $this->email === $adminEmail;
    }

    public function isAdmin(): bool
    {
        return in_array($this->role, ['admin', 'super_admin'], true);
    }

    public function isSuperAdmin(): bool
    {
        return $this->role === 'super_admin';
    }

    public function getPlanNameAttribute(): string
    {
        $sub = $this->subscription;

        if (!$sub || $sub->status !== 'active') {
            return 'free';
        }

        return match ($sub->plan) {
            'starter' => 'starter',
            'pro'     => 'pro',
            default   => 'free',
        };
    }
}
