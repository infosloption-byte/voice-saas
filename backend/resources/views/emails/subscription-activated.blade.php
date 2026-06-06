@extends('emails.layout')
@section('content')
<h1>Your {{ ucfirst($plan) }} plan is active 🎉</h1>
<p>Hi {{ $userName }}, your Voxora subscription has been activated. Here's a summary:</p>

<div class="info-box">
  <div class="info-row">
    <span class="label">Plan:</span>
    <span class="value">{{ ucfirst($plan) }}</span>
  </div>
  <div class="info-row">
    <span class="label">Status:</span>
    <span class="value">Active</span>
  </div>
  @if($nextBillingDate)
  <div class="info-row">
    <span class="label">Next billing date:</span>
    <span class="value">{{ $nextBillingDate }}</span>
  </div>
  @endif
  @if($subscriptionId)
  <div class="info-row">
    <span class="label">Subscription ID:</span>
    <span class="value">{{ $subscriptionId }}</span>
  </div>
  @endif
</div>

<div class="btn-wrap">
  <a href="{{ $appUrl }}" class="btn">Go to Voxora</a>
</div>

<div class="divider"></div>
<p class="light">You can manage or cancel your subscription any time from <strong>Settings → Billing & Plan</strong>. Cancellations remain active until the end of the current billing period.</p>
@endsection
