from __future__ import annotations

import random
import time
from collections import deque


class RateLimiter:
    def __init__(self, *, min_interval_sec: float, jitter_sec: float, max_calls_per_minute: int):
        self._min_interval = float(min_interval_sec)
        self._jitter = float(jitter_sec)
        self._max_per_minute = int(max_calls_per_minute)

        self._last_call = 0.0
        self._window = deque()

    def wait(self) -> None:
        now = time.monotonic()

        while self._window and now - self._window[0] > 60.0:
            self._window.popleft()

        if len(self._window) >= self._max_per_minute:
            sleep_for = 60.0 - (now - self._window[0])
            if sleep_for > 0:
                time.sleep(sleep_for)
            now = time.monotonic()

        gap = self._last_call + self._min_interval - now
        if gap > 0:
            time.sleep(gap)

        if self._jitter > 0:
            time.sleep(random.random() * self._jitter)

        self._last_call = time.monotonic()
        self._window.append(self._last_call)

