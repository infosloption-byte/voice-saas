<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Mail\AdminBroadcastMail;
use App\Models\User;
use App\Services\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

class AdminBroadcastController extends Controller
{
    /**
     * POST /admin/broadcast — queue an announcement email.
     * audience: all | paid | free | verified
     */
    public function send(Request $request)
    {
        $data = $request->validate([
            'subject'  => 'required|string|max:150',
            'body'     => 'required|string|max:10000',
            'audience' => 'required|in:all,paid,free,verified',
            'test'     => 'sometimes|boolean',
        ]);

        // Test mode: send only to the requesting admin
        if ($request->boolean('test')) {
            Mail::to($request->user())->queue(
                new AdminBroadcastMail($request->user()->name, $data['subject'], $data['body'])
            );
            return response()->json(['message' => 'Test email queued to your address.', 'recipients' => 1]);
        }

        $q = User::query()->whereNull('suspended_at');
        match ($data['audience']) {
            'paid'     => $q->whereHas('subscription', fn($s) => $s->where('status', 'active')),
            'free'     => $q->whereDoesntHave('subscription', fn($s) => $s->where('status', 'active')),
            'verified' => $q->whereNotNull('email_verified_at'),
            default    => null,
        };

        $count = 0;
        $q->orderBy('id')->chunk(200, function ($users) use ($data, &$count) {
            foreach ($users as $user) {
                Mail::to($user)->queue(
                    new AdminBroadcastMail($user->name, $data['subject'], $data['body'])
                );
                $count++;
            }
        });

        DB::table('admin_audit_log')->insert([
            'actor_id' => $request->user()->id,
            'action'   => 'broadcast.sent',
            'note'     => "audience={$data['audience']} subject=\"{$data['subject']}\" recipients={$count}",
            'ip'       => $request->ip(),
        ]);
        AuditLog::record('admin.broadcast', [
            'audience'   => $data['audience'],
            'subject'    => $data['subject'],
            'recipients' => $count,
        ], $request->user()->id);

        return response()->json(['message' => "Broadcast queued to {$count} users.", 'recipients' => $count]);
    }
}
