<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{ $subject ?? config('app.name') }}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0e0e10; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e2e2e2; }
    .wrapper { max-width: 580px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #1a1a1e; border: 1px solid #2a2a30; border-radius: 12px; overflow: hidden; }
    /* Header */
    .header { background: #141416; border-bottom: 1px solid #2a2a30; padding: 28px 36px; display: flex; align-items: center; gap: 12px; }
    .logo-mark { width: 36px; height: 36px; background: #c0533a; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; color: #fff; text-decoration: none; }
    .logo-name { font-size: 20px; font-weight: 700; color: #f0f0f0; letter-spacing: -0.4px; }
    /* Body */
    .body { padding: 36px; }
    h1 { font-size: 22px; font-weight: 700; color: #f0f0f0; letter-spacing: -0.3px; margin-bottom: 12px; }
    p { font-size: 15px; color: #a0a0b0; line-height: 1.7; margin-bottom: 16px; }
    p.light { color: #686878; font-size: 13px; }
    /* Button */
    .btn-wrap { text-align: center; margin: 28px 0; }
    .btn { display: inline-block; background: #c0533a; color: #fff !important; text-decoration: none; font-size: 15px; font-weight: 600; padding: 14px 36px; border-radius: 8px; letter-spacing: -0.1px; }
    /* Info box */
    .info-box { background: #111113; border: 1px solid #2a2a30; border-radius: 8px; padding: 18px 20px; margin: 20px 0; }
    .info-box p { margin: 0; color: #a0a0b0; font-size: 14px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #222228; font-size: 14px; }
    .info-row:last-child { border-bottom: none; padding-bottom: 0; }
    .info-row .label { color: #686878; }
    .info-row .value { color: #e2e2e2; font-weight: 500; }
    /* Feature list */
    .feature-list { list-style: none; margin: 16px 0; }
    .feature-list li { padding: 6px 0; font-size: 14px; color: #a0a0b0; display: flex; align-items: flex-start; gap: 10px; }
    .feature-list li::before { content: "✓"; color: #c0533a; font-weight: 700; flex-shrink: 0; margin-top: 1px; }
    /* Divider */
    .divider { height: 1px; background: #2a2a30; margin: 24px 0; }
    /* Warning box */
    .warn-box { background: rgba(192,83,58,0.08); border: 1px solid rgba(192,83,58,0.25); border-radius: 8px; padding: 16px 20px; margin: 20px 0; }
    .warn-box p { margin: 0; color: #d4876e; font-size: 14px; }
    /* Footer */
    .footer { padding: 24px 36px; border-top: 1px solid #2a2a30; background: #141416; }
    .footer p { font-size: 12px; color: #505060; line-height: 1.6; margin: 0; }
    .footer a { color: #686878; text-decoration: none; }
    .footer a:hover { color: #a0a0b0; }
  </style>
</head>
<body>
<div class="wrapper">
  <div class="card">
    <!-- Header -->
    <div class="header">
      <span class="logo-mark">V</span>
      <span class="logo-name">Voxora</span>
    </div>

    <!-- Body slot -->
    <div class="body">
      @yield('content')
    </div>

    <!-- Footer -->
    <div class="footer">
      <p>
        You're receiving this email because you have an account at Voxora.<br>
        &copy; {{ date('Y') }} Voxora. All rights reserved.<br>
        <a href="{{ config('services.paypal.frontend_url', 'https://usevoxora.online') }}">Visit Voxora</a>
        &nbsp;·&nbsp;
        <a href="{{ config('services.paypal.frontend_url', 'https://usevoxora.online') }}?page=settings">Account settings</a>
      </p>
    </div>
  </div>
</div>
</body>
</html>
