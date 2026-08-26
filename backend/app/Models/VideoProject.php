<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * Task #15 (Video Studio) Phase 1. See the migration for why this is a
 * fresh design rather than a restore of task #6a's deleted model of the
 * same name — same class name, different (and more deliberately planned)
 * shape underneath.
 */
class VideoProject extends Model
{
    protected $table = 'video_projects';

    protected $keyType = 'string';
    public $incrementing = false;

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function (VideoProject $project) {
            if (! $project->id) {
                $project->id = (string) Str::uuid();
            }
        });
    }

    protected $fillable = [
        'id', 'user_id', 'name', 'status', 'error',
        'timeline_json', 'output_video_path', 'duration_seconds',
    ];

    protected $casts = [
        'timeline_json'    => 'array',
        'duration_seconds' => 'float',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function assets(): HasMany
    {
        return $this->hasMany(VideoProjectAsset::class);
    }
}
