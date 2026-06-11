<?php

namespace App\Console\Commands;

use App\Models\Script;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class AuditAudio extends Command
{
    protected $signature = 'audio:audit
                            {--fix : Auto-fix stale flags by clearing has_audio, duration, and audio_url}
                            {--project= : Scope the audit to a specific project ID}';

    protected $description = 'Scan scripts with has_audio = true and report (or fix) ones whose audio file is missing from storage';

    public function handle(): int
    {
        $fix       = $this->option('fix');
        $projectId = $this->option('project');

        $query = Script::where('has_audio', true)->with('project');

        if ($projectId) {
            $query->where('project_id', $projectId);
        }

        $scripts = $query->get();

        if ($scripts->isEmpty()) {
            $this->info('No scripts with has_audio = true found.');
            return 0;
        }

        $stale = [];

        foreach ($scripts as $script) {
            // Derive the stored filename the same way PruneAudio does:
            // audio_url holds the filename; if null fall back to a default name.
            $filename = $script->audio_url ?? "script_{$script->id}.wav";

            if (!Storage::disk('audio')->exists($filename)) {
                $stale[] = [
                    'id'           => $script->id,
                    'project'      => optional($script->project)->name ?? $script->project_id,
                    'title'        => $script->title ?? '(no title)',
                    'missing_path' => $filename,
                    'script'       => $script,
                ];
            }
        }

        $total = $scripts->count();
        $staleCount = count($stale);
        $ok = $total - $staleCount;

        $this->info("Checked: {$total}  |  OK: {$ok}  |  Stale: {$staleCount}");

        if ($staleCount === 0) {
            $this->info('All audio references are valid.');
            return 0;
        }

        // Display table of stale scripts.
        $rows = array_map(fn ($s) => [$s['project'], $s['title'], $s['missing_path']], $stale);
        $this->table(['Project', 'Script Title', 'Missing File'], $rows);

        if ($fix) {
            foreach ($stale as $entry) {
                $entry['script']->update([
                    'has_audio' => false,
                    'duration'  => null,
                    'audio_url' => null,
                ]);
            }
            $this->info("Fixed {$staleCount} stale script(s).");
            return 0;
        }

        $this->warn('Run with --fix to clear stale flags automatically.');
        return 1;
    }
}
