<?php

namespace App\Http\Controllers;

use App\Mail\EmailVerifiedMail;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Auth\Events\Verified;
use Illuminate\Support\Facades\Mail;

class EmailVerificationController extends Controller
{
    /**
     * Resend the email verification notification.
     * Rate-limited: 6 requests per minute (applied via route middleware).
     */
    public function resend(Request $request): JsonResponse
    {
        if ($request->user()->hasVerifiedEmail()) {
            return response()->json(['message' => 'Email already verified.']);
        }

        $request->user()->sendEmailVerificationNotification();

        return response()->json(['message' => 'Verification email sent.']);
    }

    /**
     * Mark the user's email as verified and redirect to the frontend.
     * This endpoint is reached by clicking the link in the verification email.
     */
    public function verify(Request $request, int $id, string $hash): \Illuminate\Http\RedirectResponse|JsonResponse
    {
        $user = User::findOrFail($id);

        if (!hash_equals(sha1($user->getEmailForVerification()), $hash)) {
            return response()->json(['message' => 'Invalid verification link.'], 403);
        }

        $alreadyVerified = $user->hasVerifiedEmail();

        if (!$alreadyVerified) {
            $user->markEmailAsVerified();
            event(new Verified($user));

            try {
                Mail::to($user)->send(new EmailVerifiedMail($user));
            } catch (\Throwable) { /* non-fatal */ }
        }

        $frontendUrl = rtrim(config('services.paypal.frontend_url', 'http://localhost:5173'), '/');
        return redirect("{$frontendUrl}/email-verified");
    }
}
