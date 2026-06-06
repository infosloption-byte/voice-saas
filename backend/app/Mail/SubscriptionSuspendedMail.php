<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class SubscriptionSuspendedMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly User   $user,
        public readonly string $plan,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Action required — Voxora subscription suspended');
    }

    public function content(): Content
    {
        $base = rtrim(config('services.paypal.frontend_url', 'https://usevoxora.online'), '/');
        return new Content(
            view: 'emails.subscription-suspended',
            with: [
                'userName'    => $this->user->name,
                'plan'        => $this->plan,
                'pricingUrl'  => $base . '?page=pricing',
            ],
        );
    }
}
