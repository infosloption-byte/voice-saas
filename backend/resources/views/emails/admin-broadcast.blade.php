@extends('emails.layout')
@section('content')
<p>Hi {{ $userName }},</p>

{{-- Body is plain text written by an admin; preserve line breaks --}}
@foreach (preg_split('/\r\n|\r|\n/', $body) as $line)
  @if (trim($line) === '')
    <div style="height: 10px"></div>
  @else
    <p>{{ $line }}</p>
  @endif
@endforeach

<p class="light">You're receiving this because you have a Voxora account.</p>
@endsection
