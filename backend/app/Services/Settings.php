<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * DB-backed operational settings, editable from the admin panel.
 *
 * Only operational keys live here (API keys that rotate, plan IDs,
 * webhook URLs). Bootstrap secrets (DB creds, APP_KEY, mail/S3) stay
 * in .env. Secret values are encrypted at rest with APP_KEY, so the
 * .env and the DB must BOTH be compromised to recover them.
 *
 * Every key has an optional .env/config fallback so deployments keep
 * working before the setting is entered in the admin panel.
 */
class Settings
{
    private const CACHE_TTL = 300; // seconds

    /**
     * Registry of editable settings. Anything not listed here cannot be
     * written through the admin API.
     */
    public const REGISTRY = [
        'gemini_api_key' => [
            'group'    => 'Translation',
            'label'    => 'Gemini API Key',
            'help'     => 'Used by the AI engine for text translation. Rotate here when the key changes — no redeploy needed.',
            'secret'   => true,
            'fallback' => null,
        ],
        'paypal_plan_starter' => [
            'group'    => 'PayPal',
            'label'    => 'Starter Plan ID',
            'help'     => 'PayPal subscription plan ID (P-xxx…) for the Starter plan.',
            'secret'   => false,
            'fallback' => 'services.paypal.plan_starter',
        ],
        'paypal_plan_creator' => [
            'group'    => 'PayPal',
            'label'    => 'Creator Plan ID',
            'help'     => 'PayPal subscription plan ID (P-xxx…) for the Creator plan.',
            'secret'   => false,
            'fallback' => 'services.paypal.plan_creator',
        ],
        'paypal_plan_pro' => [
            'group'    => 'PayPal',
            'label'    => 'Pro Plan ID',
            'help'     => 'PayPal subscription plan ID (P-xxx…) for the Pro plan.',
            'secret'   => false,
            'fallback' => 'services.paypal.plan_pro',
        ],
        'slack_webhook_url' => [
            'group'    => 'Alerts',
            'label'    => 'Slack Webhook URL',
            'help'     => 'Incoming webhook for system alerts (failures, queue backlog, disk).',
            'secret'   => true,
            'fallback' => null,
        ],
        'moderation_keywords' => [
            'group'    => 'Moderation',
            'label'    => 'Flagged Keywords',
            'help'     => 'Comma-separated words/phrases. Scripts containing any of them appear in the Moderation report.',
            'secret'   => false,
            'fallback' => null,
        ],
        'discord_webhook_url' => [
            'group'    => 'Alerts',
            'label'    => 'Discord Webhook URL',
            'help'     => 'Discord webhook for system alerts. Leave empty to disable.',
            'secret'   => true,
            'fallback' => null,
        ],
    ];

    /** Get a setting value; DB wins, then config fallback, then $default. */
    public static function get(string $key, mixed $default = null): mixed
    {
        $meta = self::REGISTRY[$key] ?? null;

        $value = Cache::remember("app_setting:{$key}", self::CACHE_TTL, function () use ($key, $meta) {
            $row = DB::table('app_settings')->where('key', $key)->first();
            if (!$row || $row->value === null || $row->value === '') {
                return null;
            }
            if ($row->is_secret) {
                try {
                    return Crypt::decryptString($row->value);
                } catch (\Throwable) {
                    return null; // APP_KEY rotated — treat as unset
                }
            }
            return $row->value;
        });

        if ($value !== null) return $value;
        if ($meta && $meta['fallback']) {
            $fromConfig = config($meta['fallback']);
            if ($fromConfig !== null && $fromConfig !== '') return $fromConfig;
        }
        return $default;
    }

    /** Set (or clear with null/'') a registered setting. */
    public static function set(string $key, ?string $value): void
    {
        $meta = self::REGISTRY[$key] ?? null;
        if (!$meta) {
            throw new \InvalidArgumentException("Unknown setting: {$key}");
        }

        if ($value === null || $value === '') {
            DB::table('app_settings')->where('key', $key)->delete();
        } else {
            DB::table('app_settings')->updateOrInsert(
                ['key' => $key],
                [
                    'value'      => $meta['secret'] ? Crypt::encryptString($value) : $value,
                    'is_secret'  => $meta['secret'],
                    'updated_at' => now(),
                    'created_at' => now(),
                ]
            );
        }

        Cache::forget("app_setting:{$key}");
    }

    /** True if a non-empty value exists in the DB (ignores fallback). */
    public static function isSet(string $key): bool
    {
        return DB::table('app_settings')->where('key', $key)
            ->whereNotNull('value')->where('value', '!=', '')->exists();
    }
}