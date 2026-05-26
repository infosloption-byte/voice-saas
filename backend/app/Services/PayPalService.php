<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class PayPalService
{
    private string $baseUrl;
    private string $clientId;
    private string $secret;

    public function __construct()
    {
        $this->baseUrl  = config('services.paypal.mode') === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
        $this->clientId = config('services.paypal.client_id', '');
        $this->secret   = config('services.paypal.secret', '');
    }

    /**
     * Obtain a Bearer access token from PayPal OAuth endpoint.
     */
    public function getAccessToken(): string
    {
        $response = Http::withBasicAuth($this->clientId, $this->secret)
            ->asForm()
            ->post("{$this->baseUrl}/v1/oauth2/token", [
                'grant_type' => 'client_credentials',
            ]);

        if (!$response->successful()) {
            throw new RuntimeException('PayPal: failed to obtain access token — ' . $response->body());
        }

        return $response->json('access_token');
    }

    /**
     * Create a PayPal billing subscription and return approval_url + subscription_id.
     *
     * @return array{approval_url: string, subscription_id: string}
     */
    public function createSubscription(string $planId, string $returnUrl, string $cancelUrl): array
    {
        $token = $this->getAccessToken();

        $response = Http::withToken($token)
            ->post("{$this->baseUrl}/v1/billing/subscriptions", [
                'plan_id' => $planId,
                'application_context' => [
                    'return_url' => $returnUrl,
                    'cancel_url' => $cancelUrl,
                ],
            ]);

        if (!$response->successful()) {
            throw new RuntimeException('PayPal: failed to create subscription — ' . $response->body());
        }

        $data = $response->json();

        $approvalUrl = collect($data['links'] ?? [])
            ->firstWhere('rel', 'approve')['href'] ?? '';

        if (empty($approvalUrl)) {
            throw new RuntimeException('PayPal: approval URL not found in response');
        }

        return [
            'approval_url'    => $approvalUrl,
            'subscription_id' => $data['id'] ?? '',
        ];
    }

    /**
     * Retrieve subscription details from PayPal.
     */
    public function getSubscription(string $subscriptionId): array
    {
        $token = $this->getAccessToken();

        $response = Http::withToken($token)
            ->get("{$this->baseUrl}/v1/billing/subscriptions/{$subscriptionId}");

        if (!$response->successful()) {
            throw new RuntimeException('PayPal: failed to get subscription — ' . $response->body());
        }

        return $response->json();
    }

    /**
     * Cancel a PayPal subscription.
     */
    public function cancelSubscription(string $subscriptionId, string $reason = 'User cancelled'): bool
    {
        $token = $this->getAccessToken();

        $response = Http::withToken($token)
            ->post("{$this->baseUrl}/v1/billing/subscriptions/{$subscriptionId}/cancel", [
                'reason' => $reason,
            ]);

        // PayPal returns 204 No Content on success
        return $response->status() === 204 || $response->successful();
    }

    /**
     * Verify a PayPal webhook signature.
     */
    public function verifyWebhook(array $headers, string $body): bool
    {
        $token = $this->getAccessToken();

        $response = Http::withToken($token)
            ->post("{$this->baseUrl}/v1/notifications/verify-webhook-signature", [
                'auth_algo'         => $headers['paypal-auth-algo']         ?? $headers['PAYPAL-AUTH-ALGO']         ?? '',
                'cert_url'          => $headers['paypal-cert-url']          ?? $headers['PAYPAL-CERT-URL']          ?? '',
                'transmission_id'   => $headers['paypal-transmission-id']   ?? $headers['PAYPAL-TRANSMISSION-ID']   ?? '',
                'transmission_sig'  => $headers['paypal-transmission-sig']  ?? $headers['PAYPAL-TRANSMISSION-SIG']  ?? '',
                'transmission_time' => $headers['paypal-transmission-time'] ?? $headers['PAYPAL-TRANSMISSION-TIME'] ?? '',
                'webhook_id'        => config('services.paypal.webhook_id', ''),
                'webhook_event'     => json_decode($body, true),
            ]);

        if (!$response->successful()) {
            return false;
        }

        return $response->json('verification_status') === 'SUCCESS';
    }
}
