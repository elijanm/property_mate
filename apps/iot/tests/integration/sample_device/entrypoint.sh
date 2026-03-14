#!/bin/sh
set -eu

: "${TS_AUTHKEY:?TS_AUTHKEY is required}"
: "${TS_HOSTNAME:?TS_HOSTNAME is required}"
: "${TS_LOGIN_SERVER:?TS_LOGIN_SERVER is required}"
: "${PMS_BASE_URL:?PMS_BASE_URL is required}"
: "${PMS_ENTITY_ID:?PMS_ENTITY_ID is required}"
: "${PMS_API_TOKEN:?PMS_API_TOKEN is required}"

TS_STATE_DIR="${TS_STATE_DIR:-/var/lib/tailscale}"
TS_SOCKET="${TS_SOCKET:-/tmp/tailscaled.sock}"
PMS_ENTITY_TYPE="${PMS_ENTITY_TYPE:-device}"

mkdir -p "$TS_STATE_DIR"

echo "Starting tailscaled..."
tailscaled \
  --state="${TS_STATE_DIR}/tailscaled.state" \
  --socket="${TS_SOCKET}" &
TS_PID=$!

echo "Waiting for tailscaled socket..."
i=0
while [ ! -S "${TS_SOCKET}" ]; do
  i=$((i+1))
  if [ "$i" -gt 30 ]; then
    echo "tailscaled socket did not appear in time"
    exit 1
  fi
  sleep 1
done
echo "tailscaled socket is ready"

echo "Joining Headscale..."
tailscale --socket="${TS_SOCKET}" up \
  --login-server="${TS_LOGIN_SERVER}" \
  --authkey="${TS_AUTHKEY}" \
  --hostname="${TS_HOSTNAME}" \
  --accept-routes=false \
  --accept-dns=false \
  --ssh

echo "Waiting for Tailscale IPv4..."
TS_IP=""
i=0
while [ -z "${TS_IP}" ]; do
  i=$((i+1))
  if [ "$i" -gt 60 ]; then
    echo "Timed out waiting for Tailscale IP"
    tailscale --socket="${TS_SOCKET}" status || true
    exit 1
  fi
  TS_IP="$(tailscale --socket="${TS_SOCKET}" ip -4 2>/dev/null | head -n1 || true)"
  [ -n "${TS_IP}" ] || sleep 1
done
echo "Tailscale IPv4: ${TS_IP}"

echo "Fetching node from PMS..."
NODE_ID=""
i=0
while [ -z "${NODE_ID}" ]; do
  i=$((i+1))
  if [ "$i" -gt 60 ]; then
    echo "Timed out waiting for node to appear in PMS /tailscale/nodes"
    exit 1
  fi

  NODE_JSON="$(curl -fsS \
    -H "Authorization: Bearer ${PMS_API_TOKEN}" \
    "${PMS_BASE_URL}/api/v1/tailscale/nodes?page=1&page_size=200" || true)"

  echo "PMS nodes response:"
  echo "${NODE_JSON}" | jq .

  NODE_ID="$(printf '%s' "${NODE_JSON}" | jq -r --arg ip "${TS_IP}" --arg host "${TS_HOSTNAME}" '
  .[]?
  | select(
      (.hostname // .name // "") == $host
      or ((.ip_addresses // []) | index($ip))
    )
  | .node_id // empty
' | head -n1)"

  if [ -z "${NODE_ID}" ]; then
    echo "Node not visible yet in PMS, retrying..."
    sleep 2
  fi
done

echo "Found PMS node_id: ${NODE_ID}"

REGISTER_PAYLOAD="$(jq -n \
  --arg node_id "${NODE_ID}" \
  --arg entity_type "${PMS_ENTITY_TYPE}" \
  --arg entity_id "${PMS_ENTITY_ID}" \
  '{node_id: $node_id, entity_type: $entity_type, entity_id: $entity_id}')"

echo "Auto-registering node to PMS entity..."
curl -fsS -X POST \
  -H "Authorization: Bearer ${PMS_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${REGISTER_PAYLOAD}" \
  "${PMS_BASE_URL}/api/v1/tailscale/nodes/auto-register"

echo "Auto-registration complete"
echo "Starting sshd..."
exec /usr/sbin/sshd -D