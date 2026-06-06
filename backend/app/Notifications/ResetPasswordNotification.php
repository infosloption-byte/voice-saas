<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Notifications\Messages\MailMessage;

class ResetPasswordNotification extends ResetPassword
{
    public function toMail($notifiable): MailMessage
    {
        $resetUrl = $this->resetUrl($notifiable);

        return (new MailMessage)
            ->subject('Reset your Voxora password')
            ->view('emails.reset-password', [
                'userName' => $notifiable->name,
                'resetUrl' => $resetUrl,
            ]);
    }
}
