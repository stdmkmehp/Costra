#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/data/backups"
REMOTE_USER="root"
REMOTE_HOST="backup-host"
REMOTE_DIR="/data/backups/"
REMOTE_PASS="你的密码"

LATEST_BACKUP=$(find "${BACKUP_DIR}" -maxdepth 1 -type f \( -name '*.sql.gz' -o -name '*.sql' \) -printf '%T@ %p\n' | sort -nr | sed -n '1s/^[^ ]* //p')

echo "scp ${LATEST_BACKUP} -> ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}"
expect -c "
spawn scp -p ${LATEST_BACKUP} ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}
expect \"password:\"
send \"${REMOTE_PASS}\r\"
expect eof
"
echo "done"
