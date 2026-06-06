@extends('emails.layout')
@section('content')
<h1>Reset your password</h1>
<p>Hi {{ $userName }}, we received a request to reset the password for your Voxora account.</p>

<div class="btn-wrap">
  <a href="{{ $resetUrl }}" class="btn">Reset Password</a>
</div>

<div class="info-box">
  <p>This link expires in <strong>60 minutes</strong>. If you didn't request a password reset, no action is needed — your account remains secure.</p>
</div>

<div class="divider"></div>
<p class="light">If the button doesn't work, copy and paste this URL into your browser:</p>
<p class="light" style="word-break:break-all;">{{ $resetUrl }}</p>
@endsection
