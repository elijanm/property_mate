"""Symmetric encryption for secrets at rest (Fernet / AES-128-CBC + HMAC)."""
import base64

from cryptography.fernet import Fernet

from app.core.config import settings


def _fernet() -> Fernet:
    # Derive a 32-byte Fernet key from the configured secret
    raw = settings.mfa_encryption_key.encode()
    # Fernet requires URL-safe base64-encoded 32 bytes
    key = base64.urlsafe_b64encode(raw[:32].ljust(32, b"\x00"))
    return Fernet(key)


def encrypt(plaintext: str) -> str:
    """Encrypt a plaintext string; returns a URL-safe base64 ciphertext."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """Decrypt a ciphertext produced by encrypt()."""
    return _fernet().decrypt(ciphertext.encode()).decode()
