"""Optional single access PIN: signed session cookie and wrong-attempt lockout."""

from __future__ import annotations

import hashlib
import hmac
import threading
import time
from dataclasses import dataclass

COOKIE_NAME = "awdio_session"
COOKIE_MAX_AGE = 180 * 24 * 3600
MAX_FAILURES = 5
LOCKOUT_SECONDS = 60.0


@dataclass
class _Attempts:
    failures: int = 0
    locked_until: float = 0.0


class PinGate:
    def __init__(self, pin: str | None, secret: str) -> None:
        self._pin = pin
        self._token = (
            hmac.new(secret.encode(), f"awdio-session|{pin}".encode(), hashlib.sha256).hexdigest() if pin else ""
        )
        self._attempts: dict[str, _Attempts] = {}
        self._lock = threading.Lock()

    @property
    def required(self) -> bool:
        return self._pin is not None

    @property
    def token(self) -> str:
        return self._token

    def is_unlocked(self, cookie: str | None) -> bool:
        return not self.required or (cookie is not None and hmac.compare_digest(cookie, self._token))

    def locked_for(self, client: str) -> float:
        """Seconds left in this client's lockout (0 when not locked out)."""
        with self._lock:
            attempts = self._attempts.get(client)
            if attempts is None:
                return 0.0
            remaining = attempts.locked_until - time.monotonic()
            if remaining <= 0 and attempts.failures >= MAX_FAILURES:
                del self._attempts[client]
            return max(remaining, 0.0)

    def check(self, client: str, pin: str) -> bool:
        ok = self._pin is not None and hmac.compare_digest(pin.encode(), self._pin.encode())
        with self._lock:
            if ok:
                self._attempts.pop(client, None)
                return True
            attempts = self._attempts.setdefault(client, _Attempts())
            attempts.failures += 1
            if attempts.failures >= MAX_FAILURES:
                attempts.locked_until = time.monotonic() + LOCKOUT_SECONDS
            return False
