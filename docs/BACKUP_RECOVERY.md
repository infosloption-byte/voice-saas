# Database Backup & Recovery Runbook

Voxora stores all durable state (accounts, projects, scripts, voice-profile
metadata, subscriptions, usage counters) in the MySQL `db` service. Voice
audio lives on the `audio` disk (local volume or S3). This runbook covers the
database; audio is covered at the end.

## What can be lost

- The MySQL container uses a named Docker volume. If the volume is deleted or
  the host disk fails **with no backup**, all user data is permanently gone.
- Therefore automated off-host backups are mandatory before onboarding real
  users.

## Automated backups

Use `scripts/backup-db.sh`. It runs `mysqldump` inside the `voice_db`
container, gzips the result, keeps a local rolling window, and optionally
uploads to S3.

### One-time setup

1. Ensure `.env` contains `MYSQL_ROOT_PASSWORD` (already required by compose).
2. (Recommended) set an off-host target:
   ```
   BACKUP_S3_BUCKET=your-voxora-backups
   ```
   and make sure the host has AWS credentials (`aws configure` or an instance
   role).
3. Make the script executable: `chmod +x scripts/backup-db.sh`
4. Add a cron entry on the host:
   ```
   15 3 * * * cd /opt/voice-saas && ./scripts/backup-db.sh >> /var/log/voxora-backup.log 2>&1
   ```

### Verify a backup is good

```bash
# List backups
ls -lh backups/

# Test that a dump restores into a throwaway database
gunzip -c backups/voice_saas_YYYYMMDD_HHMMSS.sql.gz | head -50
```

Run a real restore drill quarterly (see below) — an untested backup is not a
backup.

## Recovery

### Full restore into the running stack

```bash
# 1. (Optional) stop the app tier so nothing writes mid-restore
docker compose stop backend

# 2. Restore the dump
gunzip -c backups/voice_saas_YYYYMMDD_HHMMSS.sql.gz \
  | docker exec -i voice_db mysql -u root -p"$MYSQL_ROOT_PASSWORD" voice_saas

# 3. Bring the app back
docker compose start backend
```

### Restore into a fresh/empty database

```bash
docker exec -i voice_db mysql -u root -p"$MYSQL_ROOT_PASSWORD" \
  -e "CREATE DATABASE IF NOT EXISTS voice_saas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

gunzip -c backups/voice_saas_YYYYMMDD_HHMMSS.sql.gz \
  | docker exec -i voice_db mysql -u root -p"$MYSQL_ROOT_PASSWORD" voice_saas
```

### Pulling a backup from S3

```bash
aws s3 cp s3://your-voxora-backups/db/voice_saas_YYYYMMDD_HHMMSS.sql.gz ./backups/
```

## Audio files

- If `AUDIO_DISK=s3`, audio durability is handled by S3 (enable versioning on
  the bucket). No extra action needed.
- If `AUDIO_DISK=local`, the audio lives in the local volume and is **not**
  covered by the DB backup. Either move to S3 for production, or add the audio
  volume to your host backup job.

## Restore-drill checklist (run quarterly)

- [ ] Latest nightly backup exists locally and in S3
- [ ] A dump restores cleanly into a throwaway database
- [ ] Row counts for `users`, `projects`, `scripts`, `subscriptions` look sane
- [ ] App boots against the restored DB and login works
