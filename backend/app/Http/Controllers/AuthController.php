<?php

namespace App\Http\Controllers;

use App\Services\AuditLog;
use App\Services\EngineResolver;
use App\Mail\AccountDeletedMail;
use App\Mail\WelcomeMail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function register(Request $request)
    {
        $request->validate([
            'name'     => 'required|string|max:255',
            'email'    => 'required|string|email|max:255|unique:users',
            'password' => ['required', Password::min(8)->mixedCase()->numbers()],
        ]);

        $user = User::create([
            'name' => $request->name,
            'email' => $request->email,
            'password' => Hash::make($request->password),
        ]);

        Auth::login($user);
        AuditLog::record('user.registered', ['email' => $user->email], $user->id);

        // Send welcome email and verification email (non-fatal if mail fails)
        try {
            Mail::to($user)->send(new WelcomeMail($user));
            $user->sendEmailVerificationNotification();
        } catch (\Throwable) { /* mail failure must not block registration */ }

        return response()->json([
            'user' => $user,
            'message' => 'Registration successful'
        ]);
    }

    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|string|email',
            'password' => 'required|string',
        ]);

        if (Auth::attempt($request->only('email', 'password'))) {
            if (Auth::user()->isSuspended() && !Auth::user()->isAdmin()) {
                Auth::guard('web')->logout();
                AuditLog::record('auth.login.suspended', ['email' => $request->input('email')]);
                return response()->json([
                    'message' => 'This account has been suspended. Contact support.',
                ], 403);
            }

            $request->session()->regenerate();
            AuditLog::record('auth.login.success', ['email' => $request->input('email')], Auth::id());

            return response()->json([
                'user' => Auth::user(),
                'message' => 'Login successful'
            ]);
        }

        AuditLog::record('auth.login.failed', ['email' => $request->input('email')]);
        throw ValidationException::withMessages([
            'email' => ['Invalid email or password.'],
        ]);
    }

    public function logout(Request $request)
    {
        AuditLog::record('auth.logout', [], $request->user()?->id);
        Auth::guard('web')->logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['message' => 'Logged out successfully']);
    }

    public function updateProfile(Request $request)
    {
        $validated = $request->validate([
            'name'  => 'sometimes|string|max:255',
            'email' => 'sometimes|string|email|max:255|unique:users,email,' . $request->user()->id,
            'bio'   => 'sometimes|nullable|string|max:500',
        ]);

        $request->user()->update($validated);

        return response()->json(['user' => $request->user()->fresh()]);
    }

    public function deleteAccount(Request $request)
    {
        $user = $request->user();
        $engineUrl = EngineResolver::activeUrl();
        $engineKey = config('services.ai_engine.key', '');

        // Delete voice files from the AI engine before removing user data
        foreach ($user->voiceProfiles as $profile) {
            if ($profile->engine_key) {
                Http::withHeaders($engineKey ? ['X-Engine-Key' => $engineKey] : [])
                    ->timeout(10)
                    ->delete("{$engineUrl}/voice-profile/{$profile->engine_key}");
            }
        }

        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        $userName  = $user->name;
        $userEmail = $user->email;

        AuditLog::record('account.deleted', ['email' => $userEmail], $user->id);
        $user->delete(); // cascades to projects, scripts, voice_profiles

        // Send farewell email after deletion (use captured values — model is gone)
        try {
            Mail::to($userEmail)->send(new AccountDeletedMail($userName, $userEmail));
        } catch (\Throwable) { /* non-fatal */ }

        return response()->json(['message' => 'Account deleted successfully']);
    }

    public function changePassword(Request $request)
    {
        $request->validate([
            'current_password' => 'required|string',
            'password'         => 'required|string|min:8|confirmed',
        ]);

        if (!Hash::check($request->current_password, $request->user()->password)) {
            throw ValidationException::withMessages([
                'current_password' => ['Current password is incorrect.'],
            ]);
        }

        $request->user()->update([
            'password' => Hash::make($request->password),
        ]);
        AuditLog::record('auth.password_changed', [], $request->user()->id);

        return response()->json(['message' => 'Password updated successfully']);
    }

    public function exportData(Request $request): \Illuminate\Http\JsonResponse
    {
        if (! \App\Services\PlanLimits::allows($request->user(), 'data_export')) {
            return response()->json([
                'message' => 'Data export (GDPR) is a Pro feature. Upgrade to Pro to export your data.',
                'code'    => 'plan_feature_data_export',
            ], 422);
        }

        $user = $request->user()->load('projects.scripts', 'voiceProfiles');

        return response()->json([
            'user' => [
                'name'       => $user->name,
                'email'      => $user->email,
                'created_at' => $user->created_at,
            ],
            'projects'       => $user->projects,
            'voice_profiles' => $user->voiceProfiles,
        ])->withHeaders([
            'Content-Disposition' => 'attachment; filename="my-data.json"',
        ]);
    }
}
