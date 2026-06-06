@extends('emails.layout')

@section('content')
<h1>Your email is verified ✓</h1>

<p>Hi {{ $user->name }},</p>

<p>
    Great news — your Voxora email address has been successfully verified.
    Your account is now fully active and ready to use.
</p>

<div class="btn-wrap">
    <a href="{{ config('services.paypal.frontend_url', 'https://usevoxora.online') }}" class="btn">
        Go to Voxora
    </a>
</div>

<div class="info-box">
    <div class="info-row">
        <span class="label">Account</span>
        <span class="value">{{ $user->email }}</span>
    </div>
    <div class="info-row">
        <span class="label">Verified on</span>
        <span class="value">{{ now()->format('M j, Y') }}</span>
    </div>
</div>

<p>
    You can now sign in and start creating voice content with Voxora.
    If you have any questions, just reply to this email.
</p>

<p class="light">
    If you didn't create a Voxora account, you can safely ignore this email.
</p>
@endsection
