<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same driver. Examples for
    | most supported storage drivers are configured here for reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
            'report' => false,
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => rtrim(env('APP_URL', 'http://localhost'), '/').'/storage',
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
            'report' => false,
        ],

        // ── Audio disk ─────────────────────────────────────────────
        // Flip AUDIO_DISK=s3 + AWS_* creds to migrate from local to S3.
        // When 'local', files land in storage/app/audio/; no other change needed.
        'audio' => array_filter([
            'driver'                  => env('AUDIO_DISK', 'local'),
            'root'                    => env('AUDIO_DISK', 'local') === 's3' ? null : storage_path('app/audio'),
            'key'                     => env('AWS_ACCESS_KEY_ID'),
            'secret'                  => env('AWS_SECRET_ACCESS_KEY'),
            'region'                  => env('AWS_DEFAULT_REGION'),
            'bucket'                  => env('AWS_BUCKET'),
            'throw'                   => false,
            'report'                  => false,
        ], fn($v) => $v !== null),

        // ── Video disk (task #6, video dubbing) ─────────────────────
        // Separate from 'audio' on purpose: video files run much larger than
        // synthesized audio, so this is deliberately a distinct disk (and can
        // point at a distinct S3 bucket/lifecycle policy) rather than sharing
        // the audio bucket's retention/cost assumptions. Flip VIDEO_DISK=s3 +
        // AWS_* creds (VIDEO_BUCKET falls back to the shared AWS_BUCKET if
        // you'd rather keep one bucket) to migrate from local to S3.
        'video' => array_filter([
            'driver'                  => env('VIDEO_DISK', 'local'),
            'root'                    => env('VIDEO_DISK', 'local') === 's3' ? null : storage_path('app/video'),
            'key'                     => env('AWS_ACCESS_KEY_ID'),
            'secret'                  => env('AWS_SECRET_ACCESS_KEY'),
            'region'                  => env('AWS_DEFAULT_REGION'),
            'bucket'                  => env('VIDEO_BUCKET', env('AWS_BUCKET')),
            'throw'                   => false,
            'report'                  => false,
        ], fn($v) => $v !== null),

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
