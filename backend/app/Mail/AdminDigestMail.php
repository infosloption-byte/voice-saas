<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class AdminDigestMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public array $stats) {}

    public function build()
    {
        return $this->subject('Voxora daily digest — ' . now()->subDay()->toFormattedDateString())
            ->view('emails.admin-digest', ['stats' => $this->stats]);
    }
}
