<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Script extends Model
{
    protected $keyType = 'string';
    public $incrementing = false;
    protected $fillable = ['id', 'project_id', 'title', 'content', 'has_audio', 'profile_id', 'language', 'duration', 'speed', 'tone', 'speaker_map', 'waveform_peaks', 'order_index', 'audio_url'];
    protected $casts = [
        'has_audio' => 'boolean',
        'waveform_peaks' => 'array',
        'speaker_map' => 'array',
    ];

    public function project()
    {
        return $this->belongsTo(Project::class);
    }
}
