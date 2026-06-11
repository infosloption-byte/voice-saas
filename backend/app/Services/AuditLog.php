<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Request;

/**
 * Structured audit logging for security-relevant events. Writes to the
 * dedicated 'audit' channel (storage/logs/audit-*.log) so login, payment,
 * admin, and deletion activity has a durable, separate trail.
 */
class AuditLog
{
    public static function record(string $event, array $context = [], ?int $userId = null): void
    {
        Log::channel('audit')->info($event, array_merge([
            'event'   => $event,
            'user_id' => $userId,
            'ip'      => Request::ip(),
            'ua'      => substr((string) Request::userAgent(), 0, 200),
            'at'      => now()->toIso8601String(),
        ], $context));
    }
}
