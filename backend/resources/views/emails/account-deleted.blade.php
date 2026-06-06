@extends('emails.layout')
@section('content')
<h1>Your account has been deleted</h1>
<p>Hi {{ $userName }}, your Voxora account has been permanently deleted as requested.</p>

<div class="info-box">
  <p>The following data has been permanently removed:</p>
  <ul class="feature-list" style="margin-top:12px;">
    <li>All projects and scripts</li>
    <li>All voice profiles and recordings</li>
    <li>All synthesised audio files</li>
    <li>Account credentials and personal data</li>
  </ul>
</div>

<div class="divider"></div>
<p class="light">If you deleted your account by mistake or have questions, please contact us by replying to this email. We may be able to help within 24 hours if data hasn't been purged yet.</p>
<p class="light">You're welcome to create a new account at any time.</p>
@endsection
