<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class PaymentReceivedMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly User    $user,
        public readonly string  $plan,
        public readonly ?string $amount,
        public readonly ?string $nextBillingDate,
        public readonly ?string $transactionId,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Payment received — Voxora ' . ucfirst($this->plan));
    }

    public function content(): Content
    {
        $base = rtrim(config('services.paypal.frontend_url', 'https://usevoxora.online'), '/');
        return new Content(
            view: 'emails.payment-received',
            with: [
                'userName'        => $this->user->name,
                'plan'            => $this->plan,
                'amount'          => $this->amount,
                'nextBillingDate' => $this->nextBillingDate,
                'transactionId'   => $this->transactionId,
                'billingUrl'      => $base . '?page=settings&section=billing',
            ],
        );
    }
}
