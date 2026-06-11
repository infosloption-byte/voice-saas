<?php

namespace App\Http\Controllers;

use App\Services\TranslationQuota;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TranslationUsageController extends Controller
{
    /** GET /api/translation/quota */
    public function quota(Request $request): JsonResponse
    {
        return response()->json(TranslationQuota::snapshot($request->user()));
    }

    /**
     * POST /api/translation/record
     * Check quota and record one translation use. Returns 422 if exhausted.
     * Response: same shape as quota().
     */
    public function record(Request $request): JsonResponse
    {
        $exceeded = TranslationQuota::checkAndRecord($request->user());

        if ($exceeded !== null) {
            return response()->json($exceeded, 422);
        }

        return response()->json(TranslationQuota::snapshot($request->user()));
    }
}
