#!/bin/bash
# Generates the shared MongoDB keyfile for replica set internal auth.
# Run this ONCE on machine1 before starting any node.
# Then copy the keyfile to machine2 and machine3.

set -e

KEYFILE_PATH="$(dirname "$0")/../keyfile"

if [ -f "$KEYFILE_PATH" ]; then
  echo "Keyfile already exists at $KEYFILE_PATH — skipping generation."
  echo "If you want to regenerate, delete it first: rm $KEYFILE_PATH"
  exit 0
fi

echo "Generating MongoDB keyfile..."
openssl rand -base64 756 > "$KEYFILE_PATH"
chmod 400 "$KEYFILE_PATH"
echo "Keyfile created at $KEYFILE_PATH"

echo ""
echo "Next steps:"
echo "  Copy to machine2:  scp $KEYFILE_PATH root@<linode1-ip>:/opt/pms-scale/keyfile"
echo "  Copy to machine3:  scp $KEYFILE_PATH root@<linode2-ip>:/opt/pms-scale/keyfile"
echo "  Then set permissions on each Linode: chmod 400 /opt/pms-scale/keyfile"
