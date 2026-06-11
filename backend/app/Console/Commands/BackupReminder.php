<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class BackupReminder extends Command
{
    protected $signature   = 'backup:check';
    protected $description = 'Warn if no database backup exists from the last 25 hours';

    public function handle(): int
    {
        $backupDir = '/home/user/voice-saas/backups';

        if (!is_dir($backupDir)) {
            $this->warn('Backup directory does not exist: ' . $backupDir);
            Log::warning('No recent database backup found', ['reason' => 'backup directory missing']);
            return self::FAILURE;
        }

        $cutoff = time() - (25 * 3600);
        $found  = false;

        foreach (glob($backupDir . '/*.sql.gz') ?: [] as $file) {
            if (filemtime($file) >= $cutoff) {
                $found = true;
                break;
            }
        }

        if (!$found) {
            $this->warn('No recent database backup found in the last 25 hours.');
            Log::warning('No recent database backup found');
            return self::FAILURE;
        }

        $this->info('Recent backup confirmed.');
        return self::SUCCESS;
    }
}
