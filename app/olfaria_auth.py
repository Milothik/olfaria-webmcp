"""Environment-backed authentication for the public Olfaria runtime.

Production accounts are supplied as salted PBKDF2 hashes through
``OLFARIA_ACCOUNTS_JSON``. No account, password or deploy-time secret belongs
in source control. A single in-memory demo account can be enabled explicitly
for development with ``OLFARIA_ENV=development`` and
``OLFARIA_DEMO_PASSWORD``.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from functools import lru_cache
import hashlib
import hmac
import json
import os
import time
from typing import Final


COOKIE_NAME: Final = "olfaria_session"
SESSION_TTL_SECONDS: Final = 60 * 60 * 24 * 30
PBKDF2_ITERATIONS: Final = 310_000


@dataclass(frozen=True)
class Account:
    username: str
    role: str
    salt_b64: str
    password_hash_b64: str


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _account_from_mapping(value: dict) -> Account:
    account = Account(
        username=str(value["username"]).strip(),
        role=str(value.get("role", "user")).strip(),
        salt_b64=str(value["salt_b64"]).strip(),
        password_hash_b64=str(value["password_hash_b64"]).strip(),
    )
    if not account.username or account.role not in {"admin", "user"}:
        raise RuntimeError("Invalid account entry in OLFARIA_ACCOUNTS_JSON")
    if len(_b64decode(account.salt_b64)) < 16 or len(_b64decode(account.password_hash_b64)) != 32:
        raise RuntimeError("Invalid PBKDF2 material in OLFARIA_ACCOUNTS_JSON")
    return account


@lru_cache(maxsize=1)
def _accounts() -> dict[str, Account]:
    raw = os.environ.get("OLFARIA_ACCOUNTS_JSON")
    if raw:
        try:
            payload = json.loads(raw)
            entries = payload.get("accounts", payload) if isinstance(payload, dict) else payload
            accounts = [_account_from_mapping(item) for item in entries]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise RuntimeError("OLFARIA_ACCOUNTS_JSON is not a valid account configuration") from error
    elif os.environ.get("OLFARIA_ENV") == "development" and os.environ.get("OLFARIA_DEMO_PASSWORD"):
        username = os.environ.get("OLFARIA_DEMO_USERNAME", "Demo").strip() or "Demo"
        password = os.environ["OLFARIA_DEMO_PASSWORD"]
        salt = hashlib.sha256(f"olfaria-development:{username}".encode()).digest()[:16]
        password_hash = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
        accounts = [Account(username, "user", _b64encode(salt), _b64encode(password_hash))]
    else:
        accounts = []

    indexed = {account.username.casefold(): account for account in accounts}
    if len(indexed) != len(accounts):
        raise RuntimeError("Account names must be unique, ignoring case")
    return indexed


def validate_runtime_configuration(host: str) -> None:
    accounts = _accounts()
    if not accounts:
        raise RuntimeError(
            "Configure OLFARIA_ACCOUNTS_JSON, or enable an explicit development account."
        )
    if host not in {"127.0.0.1", "localhost", "::1"}:
        if not os.environ.get("OLFARIA_SESSION_SECRET"):
            raise RuntimeError("OLFARIA_SESSION_SECRET is required outside localhost.")
        if os.environ.get("OLFARIA_ENV") == "development":
            raise RuntimeError("Development authentication cannot be used in a public deployment.")


def _session_secret() -> bytes:
    configured = os.environ.get("OLFARIA_SESSION_SECRET")
    if configured:
        return configured.encode("utf-8")
    return hashlib.sha256(b"olfaria-development-session-v1").digest()


def authenticate(username: str, password: str) -> Account | None:
    account = _accounts().get(username.strip().casefold())
    salt = _b64decode(account.salt_b64) if account else b"unknown-olfaria-account"
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    if account is None:
        return None
    expected = _b64decode(account.password_hash_b64)
    return account if hmac.compare_digest(candidate, expected) else None


def create_session(account: Account, now: int | None = None) -> str:
    issued_at = int(time.time() if now is None else now)
    payload = {
        "sub": account.username,
        "role": account.role,
        "iat": issued_at,
        "exp": issued_at + SESSION_TTL_SECONDS,
    }
    encoded = _b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signature = _b64encode(hmac.new(_session_secret(), encoded.encode(), hashlib.sha256).digest())
    return f"{encoded}.{signature}"


def read_session(token: str | None, now: int | None = None) -> dict | None:
    if not token or "." not in token:
        return None
    encoded, supplied_signature = token.rsplit(".", 1)
    expected_signature = _b64encode(hmac.new(_session_secret(), encoded.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(supplied_signature, expected_signature):
        return None
    try:
        payload = json.loads(_b64decode(encoded))
        current_time = int(time.time() if now is None else now)
        account = _accounts().get(str(payload["sub"]).casefold())
        if payload["exp"] < current_time or account is None or payload["role"] != account.role:
            return None
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None
    return {"username": account.username, "role": account.role}
