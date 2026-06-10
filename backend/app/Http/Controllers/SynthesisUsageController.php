<?php

namespace App\Http\Controllers;

use App\Services\SynthesisQuota;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SynthesisUsageController extends Controller
{
    /**
     * GET /api/synthesis/quota
     * Returns the authenticated user's synthesis quota for the current period.
     *
     * Response:
     *   { limit: int, used: int, remaining: int, period: 'day'|'month' }
     *   limit = 0 means unlimited (remaining is PHP_INT_MAX)
     */
    public function quota(Request $request): JsonResponse
    {
        return response()->json(SynthesisQuota::snapshot($request->user()));
    }

    /**
     * POST /api/synthesis/record
     * Increment the authenticated user's synthesis count for the current period.
     *
     * Note: server-side enforcement + recording now also happens in the
     * synthesis proxy. This endpoint is retained for backward compatibility.
     *
     * Response: same shape as quota()
     */
    public function record(Request $request): JsonResponse
    {
        SynthesisQuota::record($request->user());

        return response()->json(SynthesisQuota::snapshot($request->user()));
    }
}
