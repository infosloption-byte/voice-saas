<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class AccountDeletedMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $userName,
        public readonly string $userEmail,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Your Voxora account has been deleted');
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.account-deleted',
            with: ['userName' => $this->userName],
        );
    }
}
