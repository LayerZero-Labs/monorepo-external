#!/bin/sh

set -e

umask 0022

if [ -z "$LOCAL_UID" ] || [ -z "$LOCAL_GID" ] || [ $LOCAL_UID = 0 ] || [ $LOCAL_GID = 0 ]; then
  echo "ℹ️  LOCAL_UID/LOCAL_GID not set, running as root"
  exec "$@"
fi

groupadd -g $LOCAL_GID app || :
useradd -u $LOCAL_UID -g $LOCAL_GID -m -s /bin/sh app || :

# Docker mounts the cache volume root-owned and seeds it on first mount from
# the root-owned image content created by the dpm bootstrap at build time;
# runs as root (UID/GID unset) can also leave root-owned entries behind. dpm
# writes its install lock and downloaded SDK components throughout this tree,
# and the root-owned directories are interleaved with the growing cache, so
# only a recursive chown keeps the whole tree writable for the app user.
chown -R $LOCAL_UID:$LOCAL_GID $DPM_HOME/cache

exec gosu app "$@"
