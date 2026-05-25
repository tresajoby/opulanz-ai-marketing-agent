"""
OAuth token encryption/decryption using Fernet symmetric encryption.
Tokens are stored encrypted in the database; decrypted only when needed for API calls.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from ..config import settings

_PLACEHOLDER_VALUES = {"manual", "n8n_managed", ""}


def _fernet() -> Fernet:
    key = settings.oauth_encryption_key
    if key:
        return Fernet(key.encode() if isinstance(key, str) else key)
    # Derive a key from secret_key so tokens survive restarts even without explicit config
    digest = hashlib.sha256(settings.secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(token: str) -> str:
    if not token or token in _PLACEHOLDER_VALUES:
        return token
    return _fernet().encrypt(token.encode()).decode()


def decrypt(encrypted: str) -> str:
    if not encrypted or encrypted in _PLACEHOLDER_VALUES:
        return ""
    try:
        return _fernet().decrypt(encrypted.encode()).decode()
    except (InvalidToken, Exception):
        return ""
