#!/bin/bash
set -e

# Dynamic UID/GID entrypoint script
# Creates a user matching the host user's UID/GID to prevent permission issues
# with bind-mounted directories.

# Set reasonable umask for created files (rw-r--r-- for files, rwxr-xr-x for dirs)
umask 0022

# Cache directory paths (single source of truth)
CACHE_STELLAR="/cache/stellar"
CACHE_CARGO="/cache/cargo"
CACHE_RUSTUP="/cache/rustup"
CACHE_SCCACHE="/cache/sccache"

for dir in "$CACHE_STELLAR" "$CACHE_CARGO" "$CACHE_RUSTUP" "$CACHE_SCCACHE"; do
    mkdir -p "$dir" 2>/dev/null || true
done

# Set environment variables to point tools to cache paths
export CARGO_HOME="$CACHE_CARGO"
export RUSTUP_HOME="$CACHE_RUSTUP"
export XDG_CONFIG_HOME="/cache"  # stellar-cli uses $XDG_CONFIG_HOME/stellar
export SCCACHE_DIR="$CACHE_SCCACHE"

# If UID/GID not provided (e.g., Windows), run as root
if [ -z "${LOCAL_UID}" ] || [ -z "${LOCAL_GID}" ] || [ "${LOCAL_UID}" = "0" ] || [ "${LOCAL_GID}" = "0" ]; then
    echo "ℹ️  LOCAL_UID/LOCAL_GID not set, running as root"
    exec "$@"
fi

USER_ID="${LOCAL_UID}"
GROUP_ID="${LOCAL_GID}"

# Create group and user with the specified UID/GID
groupadd -g "$GROUP_ID" app 2>/dev/null || true
useradd -u "$USER_ID" -g "$GROUP_ID" -m -s /bin/bash app 2>/dev/null || true

# Ensure cache directories are owned by the target user
# Docker mounts volumes as root, so we need to fix ownership
# Use numeric UID:GID because the group name 'app' may not exist if GID was already taken
for dir in "$CACHE_STELLAR" "$CACHE_CARGO" "$CACHE_RUSTUP" "$CACHE_SCCACHE"; do
    chown "$USER_ID:$GROUP_ID" "$dir" 2>/dev/null || true
done

# Run command as the app user
exec gosu app "$@"
