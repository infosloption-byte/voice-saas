<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class GuestLimitsController extends Controller
{
    public function show(): JsonResponse
    {
        $row = DB::table('guest_limits')->first();

        if (!$row) {
            return response()->json([
                'synth_limit'   => 1,
                'word_limit'    => 100,
                'preview_limit' => 2,
                'script_limit'  => 3,
                'profile_limit' => 2,
                'session_days'  => 7,
            ]);
        }

        return response()->json([
            'synth_limit'   => (int) $row->synth_limit,
            'word_limit'    => (int) $row->word_limit,
            'preview_limit' => (int) $row->preview_limit,
            'script_limit'  => (int) $row->script_limit,
            'profile_limit' => (int) $row->profile_limit,
            'session_days'  => (int) $row->session_days,
        ]);
    }
}
