@extends('emails.layout')
@section('content')
<h1>Payment received</h1>
<p>Hi {{ $userName }}, we've received your payment. Your Voxora {{ ucfirst($plan) }} subscription continues uninterrupted.</p>

<div class="info-box">
  @if($amount)
  <div class="info-row">
    <span class="label">Amount</span>
    <span class="value">{{ $amount }}</span>
  </div>
  @endif
  <div class="info-row">
    <span class="label">Plan</span>
    <span class="value">{{ ucfirst($plan) }}</span>
  </div>
  @if($nextBillingDate)
  <div class="info-row">
    <span class="label">Next billing date</span>
    <span class="value">{{ $nextBillingDate }}</span>
  </div>
  @endif
  @if($transactionId)
  <div class="info-row">
    <span class="label">Transaction ID</span>
    <span class="value">{{ $transactionId }}</span>
  </div>
  @endif
</div>

<div class="btn-wrap">
  <a href="{{ $billingUrl }}" class="btn">View Billing History</a>
</div>

<div class="divider"></div>
<p class="light">Keep this email as your payment receipt. For questions about billing, reply to this email.</p>
@endsection
