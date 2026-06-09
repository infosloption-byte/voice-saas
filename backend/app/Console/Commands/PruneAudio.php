<?php

namespace App\Console\Commands;

use App\Models\Script;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class PruneAudio extends Command
{
    protected $signature   = 'audio:prune {--days=90 : Delete audio files older than this many days}';
    protected $description = 'Delete stored audio files (and clear their DB references) that have not been updated in N days';

    public function handle(): int
    {
        $days  = (int) $this->option('days');
        $cutoff = now()->subDays($days);

        $scripts = Script::whereNotNull('audio_url')
            ->where('updated_at', '<', $cutoff)
            ->get();

        if ($scripts->isEmpty()) {
            $this->info("No audio files older than {$days} days.");
            return 0;
        }

        $deleted = 0;
        foreach ($scripts as $script) {
            if (Storage::disk('audio')->exists($script->audio_url)) {
                Storage::disk('audio')->delete($script->audio_url);
            }
            $script->update(['audio_url' => null, 'has_audio' => false]);
            $deleted++;
        }

        $this->info("Pruned {$deleted} audio file(s) older than {$days} days.");
        return 0;
    }
}
