@extends('emails.layout')
@section('content')
<h1>Welcome to Voxora, {{ $userName }}! 🎙</h1>
<p>Your account is ready. You can now create AI voiceovers with your own cloned voice — all from your browser.</p>

<div class="info-box">
  <ul class="feature-list">
    <li>Clone your voice from a short recording</li>
    <li>Synthesise unlimited scripts in seconds</li>
    <li>Assemble multi-clip timelines with background music</li>
    <li>Export finished audio as WAV or MP3</li>
  </ul>
</div>

<div class="btn-wrap">
  <a href="{{ $appUrl }}" class="btn">Open Voxora</a>
</div>

<div class="divider"></div>
<p class="light">One more step — please verify your email address so we can keep your account secure. Check for a separate verification email, or visit your account settings to resend it.</p>
@endsection
