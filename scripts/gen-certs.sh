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
#   bash scripts/gen-certs.sh [--days <n>] [--host <emqx-hostname>] [--force]

# If invoked with plain `sh`, re-exec under bash (pipefail + [[ ]] are bash-only)
[ -z "${BASH_VERSION:-}" ] && exec bash "$0" "$@"

set -euo pipefail

# Git Bash on Windows converts leading '/' in -subj to a Windows path.
# MSYS_NO_PATHCONV=1 disables that conversion for openssl -subj arguments.
export MSYS_NO_PATHCONV=1

CERTS_DIR="$(cd "$(dirname "$0")/../infra/docker/certs" && pwd)"
# Git Bash returns /c/Users/... — convert to C:/Users/... for native Windows OpenSSL
if command -v cygpath >/dev/null 2>&1; then
  CERTS_DIR="$(cygpath -m "$CERTS_DIR")"
fi
CA_DAYS=${CA_DAYS:-3650}        # 10 years for dev CA
SERVER_DAYS=${SERVER_DAYS:-825} # 27 months for server cert
EMQX_HOST="localhost"
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days)   SERVER_DAYS="$2"; shift 2 ;;
    --host)   EMQX_HOST="$2";   shift 2 ;;
    --force)  FORCE=1;          shift   ;;
    *)        shift ;;
  esac
done

echo "→ Output directory: $CERTS_DIR"
mkdir -p "$CERTS_DIR"

# ── 1. CA key + self-signed certificate ──────────────────────────────────────
if [[ ! -f "$CERTS_DIR/ca.key" || "$FORCE" -eq 1 ]]; then
  echo "→ Generating CA key (EC P-256)..."
  openssl ecparam -name prime256v1 -genkey -noout -out "$CERTS_DIR/ca.key"
else
  echo "→ CA key already exists — reusing. (pass --force to regenerate)"
fi

if [[ ! -f "$CERTS_DIR/ca.crt" || "$FORCE" -eq 1 ]]; then
  echo "→ Generating CA certificate (valid ${CA_DAYS} days)..."
  openssl req -new -x509 \
    -key "$CERTS_DIR/ca.key" \
    -out "$CERTS_DIR/ca.crt" \
    -days "$CA_DAYS" \
    -subj "/CN=PMS-IoT-CA/O=PMS/OU=IoT"
else
  echo "→ CA certificate already exists — reusing. (pass --force to regenerate)"
fi

# ── 2. EMQX server key + certificate ─────────────────────────────────────────
echo "→ Generating EMQX server key (EC P-256)..."
openssl ecparam -name prime256v1 -genkey -noout -out "$CERTS_DIR/server.key"

echo "→ Generating EMQX server CSR (SAN: DNS:${EMQX_HOST}, DNS:pms_emqx, DNS:localhost, IP:127.0.0.1)..."
openssl req -new \
  -key "$CERTS_DIR/server.key" \
  -out "$CERTS_DIR/server.csr" \
  -subj "/CN=${EMQX_HOST}/O=PMS/OU=EMQX"

# Write SAN extension file using printf — avoids heredoc CRLF issues on Windows
EXT="$CERTS_DIR/server.ext"
printf '%s\n' \
  "authorityKeyIdentifier=keyid,issuer" \
  "basicConstraints=CA:FALSE" \
  "keyUsage = digitalSignature, keyEncipherment" \
  "extendedKeyUsage = serverAuth" \
  "subjectAltName = @alt_names" \
  "" \
  "[alt_names]" \
  "DNS.1 = ${EMQX_HOST}" \
  "DNS.2 = pms_emqx" \
  "DNS.3 = localhost" \
  "IP.1  = 127.0.0.1" \
  > "$EXT"

echo "→ Signing EMQX server certificate (valid ${SERVER_DAYS} days)..."
openssl x509 -req \
  -in "$CERTS_DIR/server.csr" \
  -CA "$CERTS_DIR/ca.crt" \
  -CAkey "$CERTS_DIR/ca.key" \
  -CAcreateserial \
  -out "$CERTS_DIR/server.crt" \
  -days "$SERVER_DAYS" \
  -extfile "$EXT"

rm -f "$CERTS_DIR/server.csr" "$EXT"

# ── 3. Summary ────────────────────────────────────────────────────────────────
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
echo "       IOT_CA_CERT_PEM=\$(awk 'NF {sub(/\\r/, \"\"); printf \"%s\\\\n\",\$0}' $CERTS_DIR/ca.crt)"
echo "       IOT_CA_KEY_PEM=\$(awk 'NF {sub(/\\r/, \"\"); printf \"%s\\\\n\",\$0}' $CERTS_DIR/ca.key)"
echo "  2. Restart services:"
echo "       docker compose -f infra/docker/docker-compose.yml restart iot-service emqx"
echo "  3. Test TLS connection:"
echo "       openssl s_client -connect localhost:8883 -CAfile $CERTS_DIR/ca.crt"
echo ""
echo "⚠  Add infra/docker/certs/ca.key and infra/docker/certs/server.key to .gitignore"
