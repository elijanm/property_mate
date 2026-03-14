#!/usr/bin/env bash
# gen-certs.sh — generate the internal CA + EMQX server cert for local dev/staging.
#
# Output (written to infra/docker/certs/):
#   ca.key        — CA private key  (KEEP SECRET — never commit)
#   ca.crt        — CA certificate  (shared with devices so they trust the broker)
#   server.key    — EMQX server private key
#   server.crt    — EMQX server certificate (signed by ca.key)
#
# After running this script:
#   1. Set IOT_CA_CERT_PEM in your .env:
#        IOT_CA_CERT_PEM=$(cat infra/docker/certs/ca.crt)
#        IOT_CA_KEY_PEM=$(cat infra/docker/certs/ca.key)
#   2. docker compose restart iot-service emqx
#
# Usage:
#   bash scripts/gen-certs.sh [--days <n>] [--host <emqx-hostname>]

set -euo pipefail

CERTS_DIR="$(cd "$(dirname "$0")/../infra/docker/certs" && pwd)"
CA_DAYS=${CA_DAYS:-3650}       # 10 years for dev CA
SERVER_DAYS=${SERVER_DAYS:-825} # 27 months for server cert
EMQX_HOST=${1:-localhost}

# Allow --host flag
while [[ $# -gt 0 ]]; do
  case "$1" in
    --days)   SERVER_DAYS="$2"; shift 2 ;;
    --host)   EMQX_HOST="$2";   shift 2 ;;
    *)        shift ;;
  esac
done

echo "→ Output directory: $CERTS_DIR"
mkdir -p "$CERTS_DIR"

# ── 1. CA key + self-signed certificate ──────────────────────────────────────
if [[ ! -f "$CERTS_DIR/ca.key" ]]; then
  echo "→ Generating CA key (EC P-256)..."
  openssl ecparam -name prime256v1 -genkey -noout -out "$CERTS_DIR/ca.key"
else
  echo "→ CA key already exists — reusing."
fi

if [[ ! -f "$CERTS_DIR/ca.crt" ]]; then
  echo "→ Generating CA certificate (valid ${CA_DAYS} days)..."
  openssl req -new -x509 \
    -key "$CERTS_DIR/ca.key" \
    -out "$CERTS_DIR/ca.crt" \
    -days "$CA_DAYS" \
    -subj "/CN=PMS-IoT-CA/O=PMS/OU=IoT"
else
  echo "→ CA certificate already exists — reusing."
fi

# ── 2. EMQX server key + certificate ────────────────────────────────────────
echo "→ Generating EMQX server key (EC P-256)..."
openssl ecparam -name prime256v1 -genkey -noout -out "$CERTS_DIR/server.key"

echo "→ Generating EMQX server CSR (SAN: DNS:${EMQX_HOST}, DNS:pms_emqx, DNS:localhost, IP:127.0.0.1)..."
openssl req -new \
  -key "$CERTS_DIR/server.key" \
  -out "$CERTS_DIR/server.csr" \
  -subj "/CN=${EMQX_HOST}/O=PMS/OU=EMQX"

cat > "$CERTS_DIR/server.ext" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${EMQX_HOST}
DNS.2 = pms_emqx
DNS.3 = localhost
IP.1  = 127.0.0.1
EOF

echo "→ Signing EMQX server certificate (valid ${SERVER_DAYS} days)..."
openssl x509 -req \
  -in "$CERTS_DIR/server.csr" \
  -CA "$CERTS_DIR/ca.crt" \
  -CAkey "$CERTS_DIR/ca.key" \
  -CAcreateserial \
  -out "$CERTS_DIR/server.crt" \
  -days "$SERVER_DAYS" \
  -extfile "$CERTS_DIR/server.ext"

rm -f "$CERTS_DIR/server.csr" "$CERTS_DIR/server.ext"

# ── 3. Summary ───────────────────────────────────────────────────────────────
echo ""
echo "✓ Certificates written to $CERTS_DIR/"
echo ""
echo "  CA cert:      ca.crt  (distribute to devices so they trust the broker)"
echo "  CA key:       ca.key  (KEEP SECRET — used by iot-service to sign device certs)"
echo "  Server cert:  server.crt"
echo "  Server key:   server.key"
echo ""
echo "Next steps:"
echo "  1. Export CA material into your .env:"
# echo "echo \"IOT_CA_CERT_PEM=$(awk 'NF {sub(/\r/, \"\"); printf "%s\\n",$0}' $CERTS_DIR/ca.crt)" >> .env"
# echo "IOT_CA_KEY_PEM=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0}' $CERTS_DIR/ca.key)" >> .env
echo "       echo IOT_CA_CERT_PEM=\$(awk 'NF {sub(/\\r/, \"\"); printf \"%s\\\\n\",\$0}' $CERTS_DIR/ca.crt)"
echo "       echo IOT_CA_KEY_PEM=\$(awk 'NF {sub(/\\r/, \"\"); printf \"%s\\\\n\",\$0}' $CERTS_DIR/ca.key)"
echo "  2. Restart services:"
echo "       docker compose -f infra/docker/docker-compose.yml restart iot-service emqx"
echo "  3. Test TLS connection:"
echo "       openssl s_client -connect localhost:8883 -CAfile $CERTS_DIR/ca.crt"
echo ""
echo "⚠  Add infra/docker/certs/ca.key and infra/docker/certs/server.key to .gitignore"


# openssl ecparam -name prime256v1 -genkey -noout -out infra/docker/certs/device1.key

# openssl req -new \
#   -key infra/docker/certs/device1.key \
#   -out infra/docker/certs/device1.csr \
#   -subj "/CN=edge-node-005/O=PMS/OU=IoT-Devices"

# openssl x509 -req \
#   -in infra/docker/certs/device1.csr \
#   -CA infra/docker/certs/ca.crt \
#   -CAkey infra/docker/certs/ca.key \
#   -CAcreateserial \
#   -out infra/docker/certs/device1.crt \
#   -days 365 \
#   -sha256

# step 3
# openssl s_client \
#   -connect localhost:8883 \
#   -CAfile infra/docker/certs/ca.crt \
#   -cert infra/docker/certs/device1.crt \
#   -key infra/docker/certs/device1.key
# # Subscribe
# mosquitto_sub \
# -h localhost \
# -p 8883 \
# --cafile infra/docker/certs/ca.crt \
# --cert infra/docker/certs/device1.crt \
# --key infra/docker/certs/device1.key \
# -t test/topic \
# -d

# # Publish
# mosquitto_pub \
# -h localhost \
# -p 8883 \
# --cafile infra/docker/certs/ca.crt \
# --cert infra/docker/certs/device1.crt \
# --key infra/docker/certs/device1.key \
# -t test/topic \
# -m "hello mqtt" \
# -d