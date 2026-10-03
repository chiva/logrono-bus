"""A real HTTP server impersonating the upstream API, for tests.

It runs on its own event loop in a background thread, so it serves both async tests (the library,
the service) and synchronous ones (the CLI, which calls ``asyncio.run`` itself). Being a genuine
aiohttp server rather than a client-side mock, it exercises the real request path: URL building,
query encoding, headers, status handling and JSON decoding.
"""

from __future__ import annotations

import asyncio
import json
import threading
from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

from aiohttp import web
from contract_fixtures import load_fixture

API_PREFIX = "/api/"


@dataclass(frozen=True)
class Reply:
    status: int = 200
    payload: Any = None
    body: str | None = None
    headers: dict[str, str] = field(default_factory=dict)
    delay_s: float = 0.0


@dataclass(frozen=True)
class SeenRequest:
    path: str
    query: dict[str, str]
    headers: dict[str, str]


class FakeUpstream:
    """Replies are queued per path; the last one queued keeps answering once the queue drains."""

    def __init__(self) -> None:
        self._replies: dict[str, deque[Reply]] = {}
        self.requests: list[SeenRequest] = []
        self.base_url = ""

    def reply(self, endpoint: str, reply: Reply | None = None, **kwargs: Any) -> None:
        self._replies.setdefault(endpoint, deque()).append(reply or Reply(**kwargs))

    def reply_only(self, endpoint: str, reply: Reply | None = None, **kwargs: Any) -> None:
        """Discard anything queued for ``endpoint`` and answer with this from now on."""
        self._replies[endpoint] = deque([reply or Reply(**kwargs)])

    def serve_catalog(self) -> None:
        self.reply("linesDiscovery/lines", payload=load_fixture("upstream/lines.json"))
        self.reply("linesDiscovery/stops", payload=load_fixture("upstream/stops.json"))

    def serve_arrivals(self, stop_id: str, fixture: str) -> None:
        self.reply(f"estimatedTimetable/byStop/{stop_id}", payload=load_fixture(fixture))

    def calls(self, endpoint: str) -> list[SeenRequest]:
        return [r for r in self.requests if r.path == endpoint]

    async def _handle(self, request: web.Request) -> web.StreamResponse:
        endpoint = request.path.removeprefix(API_PREFIX)
        self.requests.append(
            SeenRequest(path=endpoint, query=dict(request.query), headers=dict(request.headers))
        )
        queue = self._replies.get(endpoint)
        if not queue:
            return web.json_response(
                {"message": f"Cannot GET {request.path}", "statusCode": 404}, status=404
            )
        reply = queue.popleft() if len(queue) > 1 else queue[0]
        if reply.delay_s:
            await asyncio.sleep(reply.delay_s)
        body = reply.body if reply.body is not None else json.dumps(reply.payload)
        content_type = "application/json" if reply.body is None else "text/html"
        return web.Response(
            status=reply.status, text=body, content_type=content_type, headers=reply.headers
        )


@contextmanager
def running_fake_upstream() -> Iterator[FakeUpstream]:
    fake = FakeUpstream()
    loop = asyncio.new_event_loop()
    started = threading.Event()
    app = web.Application()
    app.router.add_get(API_PREFIX + "{tail:.*}", fake._handle)
    runner = web.AppRunner(app, access_log=None)

    async def start() -> None:
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        host, port = runner.addresses[0][:2]
        fake.base_url = f"http://{host}:{port}{API_PREFIX}"

    def serve() -> None:
        asyncio.set_event_loop(loop)
        loop.run_until_complete(start())
        started.set()
        loop.run_forever()

    thread = threading.Thread(target=serve, name="fake-upstream", daemon=True)
    thread.start()
    started.wait(timeout=5)
    try:
        yield fake
    finally:
        asyncio.run_coroutine_threadsafe(runner.cleanup(), loop).result(timeout=5)
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=5)
        loop.close()
