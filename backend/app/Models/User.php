<?php

namespace App\Models;

use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'password', 'bio'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable implements MustVerifyEmail
{
    protected $appends = ['plan_name'];

    protected $with = ['subscription'];

    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
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

    /**
     * Get the user's plan name based on active subscription.
     */
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
