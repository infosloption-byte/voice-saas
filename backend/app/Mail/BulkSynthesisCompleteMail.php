<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class BulkSynthesisCompleteMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly User   $user,
        public readonly string $projectName,
        public readonly int    $total,
        public readonly int    $completed,
        public readonly int    $failed,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "Your bulk synthesis is ready — {$this->total} scripts processed",
        );
    }

    public function content(): Content
    {
        $base = rtrim(config('services.paypal.frontend_url', 'https://usevoxora.online'), '/');
        return new Content(
            view: 'emails.bulk-synthesis-complete',
            with: [
                'userName'    => $this->user->name,
                'projectName' => $this->projectName,
                'total'       => $this->total,
                'completed'   => $this->completed,
                'failed'      => $this->failed,
                'appUrl'      => $base,
            ],
        );
    }
}
