<?php

namespace App\Providers;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        Schema::defaultStringLength(191);

        $frontend = rtrim(config('services.paypal.frontend_url', 'http://localhost:5173'), '/');
        $backend  = rtrim(config('app.url', 'http://localhost:8080'), '/');

        // Password reset link points to the SPA; the SPA reads ?token=&email= from URL
        ResetPassword::createUrlUsing(function ($user, string $token): string {
            $frontend = rtrim(config('services.paypal.frontend_url', 'http://localhost:5173'), '/');
            return "{$frontend}?token={$token}&email=" . urlencode($user->email);
        });

        // Verification link goes to the backend API which verifies, then redirects to SPA
        VerifyEmail::createUrlUsing(function ($notifiable): string {
            $backend = rtrim(config('app.url', 'http://localhost:8080'), '/');
            $id   = $notifiable->getKey();
            $hash = sha1($notifiable->getEmailForVerification());
            return "{$backend}/api/email/verify/{$id}/{$hash}";
        });
    }
}
