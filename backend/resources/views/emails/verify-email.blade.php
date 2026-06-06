@extends('emails.layout')
@section('content')
<h1>Verify your email address</h1>
<p>Hi {{ $userName }}, thanks for signing up. Please confirm your email address by clicking the button below.</p>

<div class="btn-wrap">
  <a href="{{ $verifyUrl }}" class="btn">Verify Email Address</a>
</div>

<div class="info-box">
  <p>This link expires in <strong>60 minutes</strong>. If you didn't create a Voxora account, you can safely ignore this email.</p>
</div>

<div class="divider"></div>
<p class="light">If the button doesn't work, copy and paste this URL into your browser:</p>
<p class="light" style="word-break:break-all;">{{ $verifyUrl }}</p>
@endsection
