<?php

namespace App\Http\Controllers;

use App\Mail\PaymentReceivedMail;
use App\Mail\SubscriptionActivatedMail;
use App\Mail\SubscriptionCancelledMail;
use App\Mail\SubscriptionSuspendedMail;
use App\Models\Subscription;
use App\Services\PayPalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;

class SubscriptionController extends Controller
{
    public function __construct(private readonly PayPalService $paypal) {}

    /**
     * GET /api/subscription
     * Return the authenticated user's current subscription details.
     */
    public function current(Request $request): JsonResponse
    {
        $sub = $request->user()->subscription;

        if (!$sub) {
            return response()->json([
                'plan'                    => 'free',
                'status'                  => 'active',
                'current_period_end'      => null,
                'paypal_subscription_id'  => null,
            ]);
        }

        return response()->json([
            'plan'                   => $sub->plan,
            'status'                 => $sub->status,
            'current_period_end'     => $sub->current_period_end?->toIso8601String(),
            'paypal_subscription_id' => $sub->paypal_subscription_id,
        ]);
    }

    /**
     * POST /api/subscription/create
     * Initiate a PayPal subscription for the given plan.
     */
    public function create(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'plan' => 'required|string|in:starter,pro',
        ]);

        $plan   = $validated['plan'];
        $planId = match ($plan) {
            'starter' => config('services.paypal.plan_starter'),
            'pro'     => config('services.paypal.plan_pro'),
        };

        $frontendUrl = config('services.paypal.frontend_url', 'http://localhost:5173');
        $returnUrl   = "{$frontendUrl}/subscription/success";
        $cancelUrl   = "{$frontendUrl}/subscription/cancel";

        $result = $this->paypal->createSubscription($planId, $returnUrl, $cancelUrl);

        // Upsert a pending subscription record
        $request->user()->subscription()->updateOrCreate(
            ['user_id' => $request->user()->id],
            [
                'plan'                   => $plan,
                'paypal_subscription_id' => $result['subscription_id'],
                'status'                 => 'pending',
                'current_period_end'     => null,
            ]
        );

        return response()->json([
            'approval_url'    => $result['approval_url'],
            'subscription_id' => $result['subscription_id'],
        ]);
    }

    /**
     * POST /api/subscription/capture
     * Verify activation and mark subscription as active.
     */
    public function capture(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'subscription_id' => 'required|string',
        ]);

        $details = $this->paypal->getSubscription($validated['subscription_id']);

        if (($details['status'] ?? '') !== 'ACTIVE') {
            return response()->json(['message' => 'Subscription is not active yet.'], 422);
        }

        $nextBillingTime = $details['billing_info']['next_billing_time'] ?? null;

        // Resolve plan name from PayPal plan ID — fail loudly if env is misconfigured
        $resolvedPlan = match (true) {
            $details['plan_id'] === config('services.paypal.plan_starter') => 'starter',
            $details['plan_id'] === config('services.paypal.plan_pro')     => 'pro',
            default => null,
        };

        if ($resolvedPlan === null) {
            \Illuminate\Support\Facades\Log::error('Unknown PayPal plan ID during capture', [
                'plan_id' => $details['plan_id'],
                'subscription_id' => $validated['subscription_id'],
            ]);
            return response()->json([
                'message' => 'Unrecognised plan ID. Please contact support.',
            ], 422);
        }

        $sub = $request->user()->subscription()->updateOrCreate(
            ['user_id' => $request->user()->id],
            [
                'plan'                   => $resolvedPlan,
                'paypal_subscription_id' => $validated['subscription_id'],
                'status'                 => 'active',
                'current_period_end'     => $nextBillingTime ? \Carbon\Carbon::parse($nextBillingTime) : null,
            ]
        );

        try {
            Mail::to($request->user())->send(new SubscriptionActivatedMail(
                user:            $request->user(),
                plan:            $resolvedPlan,
                nextBillingDate: $nextBillingTime
                    ? \Carbon\Carbon::parse($nextBillingTime)->format('M j, Y')
                    : null,
                subscriptionId:  $validated['subscription_id'],
            ));
        } catch (\Throwable) { /* non-fatal */ }

        return response()->json([
            'plan'   => $sub->plan,
            'status' => $sub->status,
        ]);
    }

    /**
     * GET /api/subscription/transactions
     * Return recent billing transactions for the user's subscription.
     */
    public function transactions(Request $request): JsonResponse
    {
        $sub = $request->user()->subscription;

        if (!$sub || !$sub->paypal_subscription_id) {
            return response()->json(['transactions' => []]);
        }

        $token = $this->paypal->getAccessToken();
        $baseUrl = (config('services.paypal.mode') === 'live')
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';

        // PayPal requires a date range; fetch last 2 years
        $startTime = now()->subYears(2)->toIso8601String();
        $endTime   = now()->toIso8601String();

        $response = \Illuminate\Support\Facades\Http::withToken($token)
            ->get("{$baseUrl}/v1/billing/subscriptions/{$sub->paypal_subscription_id}/transactions", [
                'start_time' => $startTime,
                'end_time'   => $endTime,
            ]);

        $transactions = $response->successful()
            ? ($response->json('transactions') ?? [])
            : [];

        return response()->json(['transactions' => $transactions]);
    }

    /**
     * POST /api/subscription/cancel
     * Cancel the user's active subscription.
     */
    public function cancel(Request $request): JsonResponse
    {
        $sub = $request->user()->subscription;

        if (!$sub || !$sub->paypal_subscription_id) {
            return response()->json(['message' => 'No active subscription found.'], 404);
        }

        $this->paypal->cancelSubscription($sub->paypal_subscription_id);

        $sub->update(['status' => 'cancelled']);

        try {
            Mail::to($request->user())->send(new SubscriptionCancelledMail(
                user:        $request->user(),
                plan:        $sub->plan,
                activeUntil: $sub->current_period_end?->format('M j, Y'),
            ));
        } catch (\Throwable) { /* non-fatal */ }

        return response()->json(['message' => 'Subscription cancelled successfully.']);
    }

    /**
     * POST /api/subscription/webhook  (public — no auth)
     * Handle incoming PayPal webhook events.
     */
    public function webhook(Request $request): JsonResponse
    {
        $headers = array_change_key_case($request->headers->all(), CASE_LOWER);
        // Flatten header arrays (Laravel wraps each header in an array)
        $flatHeaders = array_map(fn($v) => is_array($v) ? $v[0] : $v, $headers);

        $body = $request->getContent();

        if (!$this->paypal->verifyWebhook($flatHeaders, $body)) {
            return response()->json(['message' => 'Invalid webhook signature.'], 401);
        }

        $event     = $request->json()->all();
        $eventType = $event['event_type'] ?? '';
        $resource  = $event['resource'] ?? [];

        $subscriptionId = $resource['id'] ?? null;

        if (!$subscriptionId) {
            return response()->json(['message' => 'OK']);
        }

        $sub = Subscription::where('paypal_subscription_id', $subscriptionId)->first();

        if (!$sub) {
            return response()->json(['message' => 'OK']);
        }

        match ($eventType) {
            'BILLING.SUBSCRIPTION.ACTIVATED' => (function () use ($sub, $resource) {
                $nextBillingTime = $resource['billing_info']['next_billing_time'] ?? null;
                $sub->update([
                    'status'             => 'active',
                    'current_period_end' => $nextBillingTime
                        ? \Carbon\Carbon::parse($nextBillingTime)
                        : null,
                ]);
                try {
                    $user = $sub->user;
                    if ($user) {
                        Mail::to($user)->send(new SubscriptionActivatedMail(
                            user:            $user,
                            plan:            $sub->plan,
                            nextBillingDate: $nextBillingTime
                                ? \Carbon\Carbon::parse($nextBillingTime)->format('M j, Y')
                                : null,
                            subscriptionId:  $sub->paypal_subscription_id,
                        ));
                    }
                } catch (\Throwable) { /* non-fatal */ }
            })(),

            'BILLING.SUBSCRIPTION.CANCELLED' => (function () use ($sub) {
                $sub->update(['status' => 'cancelled']);
                try {
                    $user = $sub->user;
                    if ($user) {
                        Mail::to($user)->send(new SubscriptionCancelledMail(
                            user:        $user,
                            plan:        $sub->plan,
                            activeUntil: $sub->current_period_end?->format('M j, Y'),
                        ));
                    }
                } catch (\Throwable) { /* non-fatal */ }
            })(),

            'BILLING.SUBSCRIPTION.SUSPENDED' => (function () use ($sub) {
                $sub->update(['status' => 'suspended']);
                try {
                    $user = $sub->user;
                    if ($user) {
                        Mail::to($user)->send(new SubscriptionSuspendedMail(
                            user: $user,
                            plan: $sub->plan,
                        ));
                    }
                } catch (\Throwable) { /* non-fatal */ }
            })(),

            'PAYMENT.SALE.COMPLETED' => (function () use ($sub, $resource) {
                // A sale resource has no billing_info — re-fetch from PayPal API.
                try {
                    $details         = $this->paypal->getSubscription($sub->paypal_subscription_id);
                    $nextBillingTime = $details['billing_info']['next_billing_time'] ?? null;
                    $sub->update([
                        'status'             => 'active',
                        'current_period_end' => $nextBillingTime
                            ? \Carbon\Carbon::parse($nextBillingTime)
                            : $sub->current_period_end,
                    ]);

                    $user = $sub->user;
                    if ($user) {
                        $gross  = $resource['amount'] ?? [];
                        $amount = isset($gross['total'], $gross['currency'])
                            ? $gross['currency'] . ' ' . number_format((float) $gross['total'], 2)
                            : null;

                        Mail::to($user)->send(new PaymentReceivedMail(
                            user:            $user,
                            plan:            $sub->plan,
                            amount:          $amount,
                            nextBillingDate: $nextBillingTime
                                ? \Carbon\Carbon::parse($nextBillingTime)->format('M j, Y')
                                : null,
                            transactionId:   $resource['id'] ?? null,
                        ));
                    }
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::warning('PAYMENT.SALE.COMPLETED handler error', [
                        'subscription_id' => $sub->paypal_subscription_id,
                        'error'           => $e->getMessage(),
                    ]);
                }
            })(),

            default => null,
        };

        return response()->json(['message' => 'OK']);
    }
}
