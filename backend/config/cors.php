<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | supports_credentials MUST be true for Sanctum SPA cookie auth.
    | allowed_origins must list the exact frontend origin (no trailing slash).
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => array_filter(array_map('trim', explode(',', env('ALLOWED_ORIGINS', 'http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000')))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['Content-Type', 'X-XSRF-TOKEN', 'Authorization', 'Accept', 'X-Requested-With'],

    'exposed_headers' => [],

    'max_age' => 3600,

    // MUST be true for cookies (XSRF-TOKEN, session) to be sent cross-origin
    'supports_credentials' => true,

];