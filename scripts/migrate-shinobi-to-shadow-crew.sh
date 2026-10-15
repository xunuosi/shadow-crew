#!/usr/bin/env bash
set -euo pipefail

# Determine user home directory
USER_HOME="${HOME:-${USERPROFILE:-}}"
if [ -z "${USER_HOME}" ]; then
  echo "Error: Cannot determine user home directory." >&2
  exit 1
fi

SRC_DIR="${USER_HOME}/.shinobi"
DST_DIR="${USER_HOME}/.shadow-crew"

echo "=========================================================="
echo "Shadow Crew Runtime Migration: ~/.shinobi -> ~/.shadow-crew"
echo "=========================================================="

if [ -L "${SRC_DIR}" ]; then
  echo "[*] ${SRC_DIR} is already a symlink pointing to $(readlink "${SRC_DIR}"). Nothing to migrate."
  exit 0
fi

if [ ! -d "${SRC_DIR}" ]; then
  echo "[-] Source directory ${SRC_DIR} does not exist. Initializing ${DST_DIR}..."
  mkdir -p "${DST_DIR}/channels" "${DST_DIR}/logs"
  echo "[+] Initialized ${DST_DIR} successfully."
  exit 0
fi

echo "[*] Found existing runtime directory: ${SRC_DIR}"
mkdir -p "${DST_DIR}"

# Copy all files preserving permissions, timestamps, and directories
echo "[*] Copying runtime data to ${DST_DIR}..."
cp -R -p "${SRC_DIR}/"* "${DST_DIR}/" 2>/dev/null || true

echo "[*] Migrated content in ${DST_DIR}:"
ls -la "${DST_DIR}"

# Backup and create symlink
BACKUP_DIR="${USER_HOME}/.shinobi.bak_$(date +%Y%m%d_%H%M%S)"
echo "[*] Backing up original directory to ${BACKUP_DIR}..."
mv "${SRC_DIR}" "${BACKUP_DIR}"

echo "[*] Creating fallback symlink ${SRC_DIR} -> ${DST_DIR}..."
ln -s "${DST_DIR}" "${SRC_DIR}"

echo "=========================================================="
echo "✅ Migration completed successfully!"
echo "   New runtime home:    ${DST_DIR}"
echo "   Original backup at:  ${BACKUP_DIR}"
echo "=========================================================="
