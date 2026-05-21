<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VoiceProfile extends Model
{
    protected $fillable = ['user_id', 'profile_id', 'name', 'status', 'duration'];

    protected $casts = [
        'duration' => 'float',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}