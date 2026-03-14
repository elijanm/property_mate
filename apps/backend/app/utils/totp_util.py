"""TOTP helpers (RFC 6238) — wraps pyotp."""
import pyotp


def generate_secret() -> str:
    """Generate a cryptographically random base32 TOTP secret."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str, issuer: str = "PMS") -> str:
    """Return the otpauth:// URI for QR code generation."""
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name=issuer)


def verify_totp(secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code; allows ±1 step (30-second window)."""
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)
