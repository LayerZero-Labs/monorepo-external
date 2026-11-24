#!/bin/bash
set -e

# Dynamic UID/GID entrypoint script for the canton-openapi tooling image.
# Creates a user matching the host user's UID/GID to prevent permission issues
# with bind-mounted directories (e.g. the generated TypeScript client).

# Set reasonable umask for created files (rw-r--r-- for files, rwxr-xr-x for dirs)
umask 0022

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

# Run command as the app user
exec gosu app "$@"
