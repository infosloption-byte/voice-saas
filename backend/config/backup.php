<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Database backup directory
    |--------------------------------------------------------------------------
    |
    | Where the nightly *.sql.gz database dumps live. In the container this is
    | the mounted /backups volume. Read via config (not env() directly) so it
    | keeps working after `php artisan config:cache`.
    |
    */

    'dir' => env('BACKUP_DIR', '/backups'),

];
