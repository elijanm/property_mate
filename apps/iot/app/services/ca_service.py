"""
Internal Certificate Authority service.

Issues X.509 client certificates for IoT devices so they can authenticate
to the EMQX MQTT broker via mTLS (mutual TLS) instead of — or in addition
to — bcrypt passwords.

Certificate naming convention:
  CN = "d:<device_uid>"   (devices)
  CN = "gw:<gateway_uid>" (edge gateways)
  O  = "PMS"
  OU = "<org_id>"

EMQX config that uses these certs:
  listeners.ssl.default {
    ssl_options {
      cacertfile = "/opt/emqx/etc/certs/ca.crt"
      verify     = verify_peer
      fail_if_no_peer_cert = true
      peer_cert_as_username = cn   # ← extracts CN as MQTT username
    }
  }

CA key material is loaded from environment variables (or files) at startup.
If the CA is not configured the service raises CaNotConfiguredError, which
sync_service catches and records as a "partial" step — password auth still works.

Environment variables:
  IOT_CA_CERT_PEM   — PEM-encoded CA certificate
  IOT_CA_KEY_PEM    — PEM-encoded CA private key (RSA 4096 or EC P-256)
  IOT_CA_KEY_PASSPHRASE — optional passphrase for the CA key
  IOT_CERT_VALIDITY_DAYS — client cert validity (default 365)

Generate a dev CA with:
  scripts/gen-certs.sh
"""
import hashlib
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── Optional dependency — cryptography library ───────────────────────────────
# Imported lazily so the IoT service starts even when the library is absent.
# Add "cryptography" to requirements.txt to enable mTLS cert issuance.

try:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec, rsa
    from cryptography.x509.oid import NameOID
    _CRYPTO_AVAILABLE = True
except ImportError:
    _CRYPTO_AVAILABLE = False


class CaNotConfiguredError(Exception):
    """Raised when the CA key/cert is not loaded — mTLS is optional."""


# ── Module-level CA state (loaded once at startup) ───────────────────────────

_ca_cert:    Optional[object] = None   # x509.Certificate
_ca_key:     Optional[object] = None   # RSA / EC private key
_ca_loaded:  bool = False


def _load_ca() -> None:
    """Load CA key + cert from env vars or files. Called on first use."""
    global _ca_cert, _ca_key, _ca_loaded

    if not _CRYPTO_AVAILABLE:
        raise CaNotConfiguredError(
            "cryptography package not installed — add 'cryptography' to requirements.txt"
        )

    ca_cert_pem = settings.iot_ca_cert_pem or os.getenv("IOT_CA_CERT_PEM")
    ca_key_pem  = settings.iot_ca_key_pem  or os.getenv("IOT_CA_KEY_PEM")

    if not ca_cert_pem or not ca_key_pem:
        raise CaNotConfiguredError(
            "IOT_CA_CERT_PEM and IOT_CA_KEY_PEM env vars not set — "
            "run scripts/gen-certs.sh and populate them"
        )

    # Docker Compose / shell env vars can't carry real newlines inside a value,
    # so we store PEMs with literal \n and expand them here.
    ca_cert_pem = ca_cert_pem.replace("\\n", "\n")
    ca_key_pem  = ca_key_pem.replace("\\n", "\n")

    passphrase_str = settings.iot_ca_key_passphrase or os.getenv("IOT_CA_KEY_PASSPHRASE")
    passphrase = passphrase_str.encode() if passphrase_str else None

    _ca_cert = x509.load_pem_x509_certificate(ca_cert_pem.encode())
    _ca_key  = serialization.load_pem_private_key(ca_key_pem.encode(), password=passphrase)
    _ca_loaded = True
    logger.info("ca_loaded", subject=_ca_cert.subject.rfc4514_string())


def _ensure_ca() -> None:
    global _ca_loaded
    if not _ca_loaded:
        _load_ca()


# ── Public API ────────────────────────────────────────────────────────────────

async def issue_device_cert(
    device_uid: str,
    org_id: str = "",
    validity_days: Optional[int] = None,
) -> Dict[str, object]:
    """
    Issue a client certificate for a device.

    Returns a dict:
      cert_pem     — PEM-encoded certificate (write to /etc/device/client.crt)
      key_pem      — PEM-encoded EC P-256 private key (write to /etc/device/client.key)
      fingerprint  — SHA-256 hex fingerprint (stored on Device model for revocation)
      expires_at   — datetime (UTC)
    """
    _ensure_ca()

    days = validity_days or int(os.getenv("IOT_CERT_VALIDITY_DAYS", "365"))
    now  = datetime.now(timezone.utc)

    # Generate a fresh EC P-256 key for the device (small + fast on embedded systems)
    device_key = ec.generate_private_key(ec.SECP256R1())

    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME,          f"d:{device_uid}"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME,    "PMS"),
        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, org_id or "default"),
    ])

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(_ca_cert.subject)
        .public_key(device_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=days))
        .add_extension(
            x509.BasicConstraints(ca=False, path_length=None), critical=True
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_encipherment=True,
                content_commitment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([x509.ExtendedKeyUsageOID.CLIENT_AUTH]),
            critical=False,
        )
        .sign(_ca_key, hashes.SHA256())
    )

    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
    key_pem  = device_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()

    # SHA-256 fingerprint of the DER-encoded cert (matches what EMQX logs)
    fingerprint = hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest()

    logger.info(
        "device_cert_issued",
        device_uid=device_uid,
        fingerprint=fingerprint,
        expires_at=cert.not_valid_after_utc.isoformat(),
    )

    return {
        "cert_pem":    cert_pem,
        "key_pem":     key_pem,
        "fingerprint": fingerprint,
        "expires_at":  cert.not_valid_after_utc,
    }


async def issue_gateway_cert(
    gateway_uid: str,
    org_id: str = "",
    validity_days: Optional[int] = None,
) -> Dict[str, object]:
    """Issue a client certificate for an edge gateway (CN = gw:<gateway_uid>)."""
    _ensure_ca()

    days = validity_days or int(os.getenv("IOT_CERT_VALIDITY_DAYS", "365"))
    now  = datetime.now(timezone.utc)

    device_key = ec.generate_private_key(ec.SECP256R1())

    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME,          f"gw:{gateway_uid}"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME,    "PMS"),
        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, org_id or "default"),
    ])

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(_ca_cert.subject)
        .public_key(device_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=days))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.ExtendedKeyUsage([x509.ExtendedKeyUsageOID.CLIENT_AUTH]), critical=False
        )
        .sign(_ca_key, hashes.SHA256())
    )

    cert_pem    = cert.public_bytes(serialization.Encoding.PEM).decode()
    key_pem     = device_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    fingerprint = hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest()

    return {
        "cert_pem":    cert_pem,
        "key_pem":     key_pem,
        "fingerprint": fingerprint,
        "expires_at":  cert.not_valid_after_utc,
    }


async def get_ca_cert_pem() -> str:
    """Return the CA certificate PEM so devices can pin it."""
    _ensure_ca()
    return _ca_cert.public_bytes(serialization.Encoding.PEM).decode()
