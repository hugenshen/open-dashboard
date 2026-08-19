"""SSE recording helpers for Harness runs."""

from __future__ import annotations

from typing import Iterable, Iterator

from agent.run_controller import RunController


class EventStreamRecorder:
    """Wrap an SSE generator and persist each parsed event into the run trace."""

    def __init__(self, controller: RunController):
        self.controller = controller

    def wrap(self, chunks: Iterable[str]) -> Iterator[str]:
        for chunk in chunks:
            self.controller.observe_chunk(chunk)
            yield chunk
