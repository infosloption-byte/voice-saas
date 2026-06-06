@extends('emails.layout')
@section('content')
<h1>Subscription suspended</h1>
<p>Hi {{ $userName }}, your Voxora {{ ucfirst($plan) }} subscription has been suspended due to a failed payment.</p>

<div class="warn-box">
  <p>⚠️ Your account has been downgraded to the free plan. Premium features are currently unavailable.</p>
</div>

<p>To restore full access, please update your payment method with PayPal and reactivate your subscription.</p>

<div class="btn-wrap">
  <a href="{{ $pricingUrl }}" class="btn">Reactivate Subscription</a>
</div>

<div class="divider"></div>
<p class="light">Your projects, scripts, and voice profiles are safely stored and will be accessible once your subscription is reactivated. If you need help, reply to this email.</p>
@endsection
