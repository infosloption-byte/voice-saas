<?php

namespace App\Http\Controllers;

use App\Models\Subscription;
use App\Services\PayPalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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

        $plan              = strtolower($details['plan_id'] ?? '');
        $nextBillingTime   = $details['billing_info']['next_billing_time'] ?? null;

        // Resolve plan name from PayPal plan ID
        $resolvedPlan = match (true) {
            $details['plan_id'] === config('services.paypal.plan_starter') => 'starter',
            $details['plan_id'] === config('services.paypal.plan_pro')     => 'pro',
            default                                                         => 'starter',
        };

        $sub = $request->user()->subscription()->updateOrCreate(
            ['user_id' => $request->user()->id],
            [
                'plan'                   => $resolvedPlan,
                'paypal_subscription_id' => $validated['subscription_id'],
                'status'                 => 'active',
                'current_period_end'     => $nextBillingTime ? \Carbon\Carbon::parse($nextBillingTime) : null,
            ]
        );

        return response()->json([
            'plan'   => $sub->plan,
            'status' => $sub->status,
        ]);
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
            'BILLING.SUBSCRIPTION.ACTIVATED' => $sub->update([
                'status'             => 'active',
                'current_period_end' => isset($resource['billing_info']['next_billing_time'])
                    ? \Carbon\Carbon::parse($resource['billing_info']['next_billing_time'])
                    : null,
            ]),

            'BILLING.SUBSCRIPTION.CANCELLED' => $sub->update(['status' => 'cancelled']),

            'BILLING.SUBSCRIPTION.SUSPENDED' => $sub->update(['status' => 'suspended']),

            'PAYMENT.SALE.COMPLETED' => (function () use ($sub, $resource) {
                // Refresh period end if billing info is available
                if (isset($resource['billing_info']['next_billing_time'])) {
                    $sub->update([
                        'status'             => 'active',
                        'current_period_end' => \Carbon\Carbon::parse($resource['billing_info']['next_billing_time']),
                    ]);
                }
            })(),

            default => null,
        };

        return response()->json(['message' => 'OK']);
    }
}
