@extends('emails.layout')
@section('content')
<h1>Subscription cancelled</h1>
<p>Hi {{ $userName }}, your Voxora {{ ucfirst($plan) }} subscription has been cancelled.</p>

<div class="info-box">
  <div class="info-row">
    <span class="label">Plan:</span>
    <span class="value">{{ ucfirst($plan) }}</span>
  </div>
  @if($activeUntil)
  <div class="info-row">
    <span class="label">Access until:</span>
    <span class="value">{{ $activeUntil }}</span>
  </div>
  @endif
</div>

@if($activeUntil)
<p>You'll continue to have full access to all {{ ucfirst($plan) }} features until <strong>{{ $activeUntil }}</strong>. After that your account will revert to the free plan.</p>
@endif

<div class="btn-wrap">
  <a href="{{ $pricingUrl }}" class="btn">Resubscribe</a>
</div>

<div class="divider"></div>
<p class="light">Changed your mind? You can resubscribe any time from Settings → Billing & Plan. Your projects and voice profiles are safe.</p>
@endsection
