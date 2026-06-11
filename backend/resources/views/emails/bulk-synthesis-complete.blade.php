@extends('emails.layout')
@section('content')
<h1>Bulk synthesis complete 🎙</h1>
<p>Hi {{ $userName }}, your bulk synthesis job for <strong>{{ $projectName }}</strong> has finished.</p>

<div class="info-box">
  <div class="info-row">
    <span class="label">Project:</span>
    <span class="value">{{ $projectName }}</span>
  </div>
  <div class="info-row">
    <span class="label">Total scripts:</span>
    <span class="value">{{ $total }}</span>
  </div>
  <div class="info-row">
    <span class="label">Completed:</span>
    <span class="value">{{ $completed }}</span>
  </div>
  @if($failed > 0)
  <div class="info-row">
    <span class="label">Failed:</span>
    <span class="value">{{ $failed }}</span>
  </div>
  @endif
</div>

@if($failed > 0)
<div class="warn-box">
  <p>{{ $failed }} {{ $failed === 1 ? 'script' : 'scripts' }} could not be synthesised. Open your project to retry the failed items.</p>
</div>
@endif

<div class="btn-wrap">
  <a href="{{ $appUrl }}" class="btn">Open Voxora</a>
</div>

<div class="divider"></div>
<p class="light">You can manage notification preferences from <strong>Settings → Notifications</strong>.</p>
@endsection
