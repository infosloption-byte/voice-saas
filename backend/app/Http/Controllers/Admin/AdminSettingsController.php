<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\AuditLog;
use App\Services\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Admin-editable operational settings (API keys, plan IDs, webhooks).
 * Secret values are never returned — only whether they are set.
 * Writes are restricted to super admins and fully audited.
 */
class AdminSettingsController extends Controller
{
    /** GET /admin/settings — registry + current state (secrets masked) */
    public function index()
    {
        $groups = [];
        foreach (Settings::REGISTRY as $key => $meta) {
            $isSet = Settings::isSet($key);
            $groups[$meta['group']][] = [
                'key'          => $key,
                'label'        => $meta['label'],
                'help'         => $meta['help'],
                'secret'       => $meta['secret'],
                'is_set'       => $isSet,
                // Plain values are shown; secrets only report set/unset
                'value'        => (!$meta['secret'] && $isSet) ? Settings::get($key) : null,
                'has_fallback' => (bool) ($meta['fallback'] && config($meta['fallback'])),
            ];
        }
        return response()->json(['groups' => $groups]);
    }

    /** PUT /admin/settings — update one or more settings (super_admin) */
    public function update(Request $request)
    {
        if (! $request->user()->isSuperAdmin()) {
            return response()->json(['message' => 'Only super admins can change settings.'], 403);
        }

        $data = $request->validate([
            'settings'   => ['required', 'array', 'min:1'],
            'settings.*' => ['nullable', 'string', 'max:2000'],
        ]);

        $unknown = array_diff(array_keys($data['settings']), array_keys(Settings::REGISTRY));
        if ($unknown) {
            return response()->json(['message' => 'Unknown setting: ' . implode(', ', $unknown)], 422);
        }

        foreach ($data['settings'] as $key => $value) {
            $meta      = Settings::REGISTRY[$key];
            $wasSet    = Settings::isSet($key);
            $oldPlain  = $meta['secret'] ? null : Settings::get($key);

            Settings::set($key, $value);

            $cleared = ($value === null || $value === '');
            DB::table('admin_audit_log')->insert([
                'actor_id'     => $request->user()->id,
                'action'       => "setting.changed ({$key})",
                // Never write secret values into the audit log
                'before_value' => $meta['secret'] ? ($wasSet ? '(set)' : '(empty)') : (string) ($oldPlain ?? '(empty)'),
                'after_value'  => $meta['secret'] ? ($cleared ? '(cleared)' : '(updated)') : (string) ($value ?: '(cleared)'),
                'ip'           => $request->ip(),
            ]);
            AuditLog::record('admin.setting_changed', ['key' => $key], $request->user()->id);
        }

        return response()->json(['message' => 'Settings saved.']);
    }
}
