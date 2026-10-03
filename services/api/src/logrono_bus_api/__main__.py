"""``logrono-bus-api``: serve the API (default) or print its OpenAPI document.

logrono-bus-api                 # serve, configured from LOGRONO_BUS_* variables
logrono-bus-api openapi         # OpenAPI JSON on stdout (``just gen`` writes it to contracts/)
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence

import uvicorn

from logrono_bus_api.main import create_app
from logrono_bus_api.settings import Settings


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="logrono-bus-api", description=__doc__.splitlines()[0])
    parser.add_argument("command", nargs="?", choices=["serve", "openapi"], default="serve")
    args = parser.parse_args(argv)
    settings = Settings()
    app = create_app(settings)
    if args.command == "openapi":
        json.dump(app.openapi(), sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return
    # One worker on purpose: the arrivals cache, single-flight and the upstream rate limit are
    # per-process, so N workers would multiply the load on the upstream by N.
    uvicorn.run(app, host=settings.host, port=settings.port, proxy_headers=True, log_config=None)


if __name__ == "__main__":
    main()
