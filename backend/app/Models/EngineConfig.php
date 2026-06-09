<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EngineConfig extends Model
{
    protected $fillable = ['name', 'url', 'is_active', 'status', 'latency_ms', 'last_tested_at'];

    protected $casts = [
        'is_active'      => 'boolean',
        'last_tested_at' => 'datetime',
    ];
}
