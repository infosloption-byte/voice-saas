<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class SubscriptionCancelledMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly User    $user,
        public readonly string  $plan,
        public readonly ?string $activeUntil,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Your Voxora subscription has been cancelled');
    }

    public function content(): Content
    {
        $base = rtrim(config('services.paypal.frontend_url', 'https://usevoxora.online'), '/');
        return new Content(
            view: 'emails.subscription-cancelled',
            with: [
                'userName'    => $this->user->name,
                'plan'        => $this->plan,
                'activeUntil' => $this->activeUntil,
                'pricingUrl'  => $base . '?page=pricing',
            ],
        );
    }
}
