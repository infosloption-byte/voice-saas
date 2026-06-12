<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#f6f7f9; margin:0; padding:24px;">
  <div style="max-width:560px; margin:0 auto; background:#fff; border-radius:10px; padding:28px; border:1px solid #e5e7eb;">
    <h2 style="margin:0 0 4px; font-size:18px; color:#111827;">Voxora — Daily Digest</h2>
    <p style="margin:0 0 20px; font-size:13px; color:#6b7280;">{{ $stats['date'] }}</p>

    <table style="width:100%; border-collapse:collapse; font-size:13px;">
      @foreach ([
        'New signups'        => $stats['signups'],
        'Active users'       => $stats['active_users'],
        'Synthesis jobs'     => $stats['jobs'],
        'Failed jobs'        => $stats['failed'],
        'Words synthesized'  => number_format($stats['words']),
        'New subscriptions'  => $stats['new_subs'],
        'Cancellations'      => $stats['cancellations'],
        'Estimated MRR'      => '$' . number_format($stats['mrr'], 2),
      ] as $label => $value)
        <tr>
          <td style="padding:8px 0; color:#6b7280; border-bottom:1px solid #f3f4f6;">{{ $label }}</td>
          <td style="padding:8px 0; color:#111827; font-weight:600; text-align:right; border-bottom:1px solid #f3f4f6;">{{ $value }}</td>
        </tr>
      @endforeach
    </table>

    @if ($stats['failed'] > 0)
      <p style="margin:18px 0 0; font-size:12px; color:#b45309; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px 12px;">
        ⚠ {{ $stats['failed'] }} job(s) failed yesterday — check the Failures report in the admin panel.
      </p>
    @endif

    <p style="margin:22px 0 0; font-size:11px; color:#9ca3af;">
      Sent automatically to admins. Configure in the admin panel.
    </p>
  </div>
</body>
</html>
