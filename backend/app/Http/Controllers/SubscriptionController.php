<?php

namespace App\Http\Controllers;

use App\Mail\PaymentReceivedMail;
use App\Mail\SubscriptionActivatedMail;
use App\Mail\SubscriptionCancelledMail;
use App\Mail\SubscriptionSuspendedMail;
use App\Models\Subscription;
use App\Services\AuditLog;
use App\Services\PayPalService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class SubscriptionController extends Controller
{
    public function __construct(private readonly PayPalService $paypal) {}

    /** GET /api/subscription */
    public function current(Request $request): JsonResponse
    {
        $sub = $request->user()->subscription;

        if (! $sub) {
            return response()->json([
                'plan'                   => 'free',
                'status'                 => 'active',
                'current_period_end'     => null,
                'paypal_subscription_id' => null,
            ]);
        }

        return response()->json([
            'plan'                   => $sub->plan,
            'status'                 => $sub->status,
            'current_period_end'     => $sub->current_period_end?->toIso8601String(),
            'paypal_subscription_id' => $sub->paypal_subscription_id,
        ]);
    }

    /** POST /api/subscription/create */
    public function create(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'plan' => 'required|string|in:starter,creator,pro',
        ]);

        $plan   = $validated['plan'];
        // Admin-panel managed setting; falls back to .env via the registry
        $planId = match ($plan) {
            'starter' => \App\Services\Settings::get('paypal_plan_starter'),
            'creator' => \App\Services\Settings::get('paypal_plan_creator'),
            'pro'     => \App\Services\Settings::get('paypal_plan_pro'),
        };

        $frontendUrl = config('services.paypal.frontend_url', 'http://localhost:5173');
        $result      = $this->paypal->createSubscription(
            $planId,
            "{$frontendUrl}/subscription/success",
            "{$frontendUrl}/subscription/cancel",
        );

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

    /** POST /api/subscription/capture */
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

        $resolvedPlan = match (true) {
            $details['plan_id'] === \App\Services\Settings::get('paypal_plan_starter') => 'starter',
            $details['plan_id'] === \App\Services\Settings::get('paypal_plan_creator') => 'creator',
            $details['plan_id'] === \App\Services\Settings::get('paypal_plan_pro')     => 'pro',
            default => null,
        };

        if ($resolvedPlan === null) {
            Log::error('Unknown PayPal plan ID during capture', [
                'plan_id'         => $details['plan_id'],
                'subscription_id' => $validated['subscription_id'],
            ]);
            return response()->json(['message' => 'Unrecognised plan ID. Please contact support.'], 422);
        }

        $sub = $request->user()->subscription()->updateOrCreate(
            ['user_id' => $request->user()->id],
            [
                'plan'                   => $resolvedPlan,
                'paypal_subscription_id' => $validated['subscription_id'],
                'status'                 => 'active',
                'current_period_end'     => $nextBillingTime ? Carbon::parse($nextBillingTime) : null,
            ]
        );

        try {
            Mail::to($request->user())->send(new SubscriptionActivatedMail(
                user:            $request->user(),
                plan:            $resolvedPlan,
                nextBillingDate: $nextBillingTime ? Carbon::parse($nextBillingTime)->format('M j, Y') : null,
                subscriptionId:  $validated['subscription_id'],
            ));
        } catch (\Throwable) { /* non-fatal */ }

        AuditLog::record('subscription.activated', [
            'plan'            => $resolvedPlan,
            'subscription_id' => $validated['subscription_id'],
        ], $request->user()->id);

        return response()->json(['plan' => $sub->plan, 'status' => $sub->status]);
    }

    /** GET /api/subscription/transactions */
    public function transactions(Request $request): JsonResponse
    {
        $sub = $request->user()->subscription;

        if (! $sub?->paypal_subscription_id) {
            return response()->json(['transactions' => []]);
        }

        $response = \Illuminate\Support\Facades\Http::withToken($this->paypal->getAccessToken())
            ->get($this->paypal->subscriptionsUrl($sub->paypal_subscription_id) . '/transactions', [
                'start_time' => now()->subYears(2)->toIso8601String(),
                'end_time'   => now()->toIso8601String(),
            ]);

        return response()->json([
            'transactions' => $response->successful() ? ($response->json('transactions') ?? []) : [],
        ]);
    }

    /** POST /api/subscription/cancel */
    public function cancel(Request $request): JsonResponse
    {
        $sub = $request->user()->subscription;

        if (! $sub?->paypal_subscription_id) {
            return response()->json(['message' => 'No active subscription found.'], 404);
        }

        $this->paypal->cancelSubscription($sub->paypal_subscription_id);
        $sub->update(['status' => 'cancelled']);
        AuditLog::record('subscription.cancelled', [
            'plan'            => $sub->plan,
            'subscription_id' => $sub->paypal_subscription_id,
        ], $request->user()->id);

        try {
            Mail::to($request->user())->send(new SubscriptionCancelledMail(
                user:        $request->user(),
                plan:        $sub->plan,
                activeUntil: $sub->current_period_end?->format('M j, Y'),
            ));
        } catch (\Throwable) { /* non-fatal */ }

        return response()->json(['message' => 'Subscription cancelled successfully.']);
    }

    /** POST /api/subscription/webhook  (public — no auth) */
    public function webhook(Request $request): JsonResponse
    {
        $headers = array_map(
            fn($v) => is_array($v) ? $v[0] : $v,
            array_change_key_case($request->headers->all(), CASE_LOWER)
        );

        if (! $this->paypal->verifyWebhook($headers, $request->getContent())) {
            return response()->json(['message' => 'Invalid webhook signature.'], 401);
        }

        $event     = $request->json()->all();
        $eventType = $event['event_type'] ?? '';
        $resource  = $event['resource'] ?? [];

        $subscriptionId = $resource['id'] ?? null;
        if (! $subscriptionId) {
            return response()->json(['message' => 'OK']);
        }

        $sub = Subscription::where('paypal_subscription_id', $subscriptionId)->first();
        if (! $sub) {
            return response()->json(['message' => 'OK']);
        }

        match ($eventType) {
            'BILLING.SUBSCRIPTION.ACTIVATED' => $this->onActivated($sub, $resource),
            'BILLING.SUBSCRIPTION.CANCELLED' => $this->onCancelled($sub),
            'BILLING.SUBSCRIPTION.SUSPENDED' => $this->onSuspended($sub),
            'PAYMENT.SALE.COMPLETED'         => $this->onPaymentCompleted($sub, $resource),
            default                          => null,
        };

        return response()->json(['message' => 'OK']);
    }

    // ── Webhook event handlers ────────────────────────────────────────

    private function onActivated(Subscription $sub, array $resource): void
    {
        $nextBillingTime = $resource['billing_info']['next_billing_time'] ?? null;
        $sub->update([
            'status'             => 'active',
            'current_period_end' => $nextBillingTime ? Carbon::parse($nextBillingTime) : null,
        ]);
        try {
            $user = $sub->user;
            if ($user) {
                Mail::to($user)->send(new SubscriptionActivatedMail(
                    user:            $user,
                    plan:            $sub->plan,
                    nextBillingDate: $nextBillingTime ? Carbon::parse($nextBillingTime)->format('M j, Y') : null,
                    subscriptionId:  $sub->paypal_subscription_id,
                ));
            }
        } catch (\Throwable) { /* non-fatal */ }
    }

    private function onCancelled(Subscription $sub): void
    {
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
    }

    private function onSuspended(Subscription $sub): void
    {
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
    }

    private function onPaymentCompleted(Subscription $sub, array $resource): void
    {
        try {
            $details         = $this->paypal->getSubscription($sub->paypal_subscription_id);
            $nextBillingTime = $details['billing_info']['next_billing_time'] ?? null;
            $sub->update([
                'status'             => 'active',
                'current_period_end' => $nextBillingTime
                    ? Carbon::parse($nextBillingTime)
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
                    nextBillingDate: $nextBillingTime ? Carbon::parse($nextBillingTime)->format('M j, Y') : null,
                    transactionId:   $resource['id'] ?? null,
                ));
            }
        } catch (\Throwable $e) {
            Log::warning('PAYMENT.SALE.COMPLETED handler error', [
                'subscription_id' => $sub->paypal_subscription_id,
                'error'           => $e->getMessage(),
            ]);
        }
    }
}