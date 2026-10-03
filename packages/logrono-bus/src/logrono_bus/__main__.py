"""Command-line interface: ``logrono-bus`` (or ``python -m logrono_bus``).

Subcommands::

    logrono-bus lineas                        # líneas y sentidos
    logrono-bus paradas --buscar ayuntamiento # buscar paradas por nombre
    logrono-bus paradas --cerca 42.4655,-2.4390
    logrono-bus llegadas 101 --lineas 2d.5a   # próximas llegadas
    logrono-bus horario 10                    # horario de hoy de una línea
    logrono-bus grabar 101 100 --salida DIR   # guardar respuestas reales (fixtures)

``--json`` prints the canonical JSON form instead of a table.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Final

import aiohttp

from logrono_bus._version import __version__
from logrono_bus.board import STOP_SEPARATOR, parse_selection
from logrono_bus.errors import LogronoBusError
from logrono_bus.models import TIMEZONE, Catalog, LineTimetable, Stop, StopArrivals
from logrono_bus.providers.logrono.client import (
    DEFAULT_BASE_URL,
    ENDPOINT_ARRIVALS,
    ENDPOINT_LINES,
    ENDPOINT_STOPS,
    LogronoBusClient,
)
from logrono_bus.providers.logrono.provider import LogronoBusProvider
from logrono_bus.providers.logrono.raw import parse_stops
from logrono_bus.serialize import to_json
from logrono_bus.timetable import describe_interval

EXIT_OK: Final = 0
EXIT_ERROR: Final = 1

RECORD_PREVIEW_MINUTES: Final = 60
DEPARTURES_PER_ROW: Final = 12


def _parse_point(value: str) -> tuple[float, float]:
    try:
        lat, lon = (float(part) for part in value.split(","))
    except ValueError:
        raise argparse.ArgumentTypeError(
            "usa el formato LAT,LON (p. ej. 42.4655,-2.4390)"
        ) from None
    return lat, lon


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="logrono-bus", description="Estimaciones de paso de los autobuses de Logroño."
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("--json", action="store_true", help="salida JSON en lugar de tabla")
    parser.add_argument(
        "--origen", default=DEFAULT_BASE_URL, metavar="URL", help="URL base del servicio de datos"
    )
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("lineas", help="líneas y sus sentidos")

    stops = commands.add_parser("paradas", help="buscar paradas")
    query = stops.add_mutually_exclusive_group(required=True)
    query.add_argument("--buscar", metavar="TEXTO", help="nombre o número de parada")
    query.add_argument("--cerca", metavar="LAT,LON", type=_parse_point, help="paradas cercanas")
    stops.add_argument("--radio", type=float, default=500, help="metros (por defecto 500)")

    arrivals = commands.add_parser("llegadas", help="próximas llegadas a una parada")
    arrivals.add_argument("parada", help="número de parada, p. ej. 101")
    arrivals.add_argument(
        "--lineas", metavar="SELECCIÓN", help="líneas y sentido, p. ej. 2d.5a (d=vuelta, a=ida)"
    )

    timetable = commands.add_parser("horario", help="horario de hoy de una línea")
    timetable.add_argument("linea", help="línea, p. ej. 10 o 31 (la B1)")

    record = commands.add_parser("grabar", help="guardar respuestas reales del servicio")
    record.add_argument("paradas", nargs="+", help="paradas cuyas llegadas guardar")
    record.add_argument("--salida", type=Path, required=True, help="directorio de destino")
    return parser


def _print_lines(catalog: Catalog) -> None:
    for line in catalog.lines:
        print(f"{line.label:>3}  {line.name}  ({line.colour})")
        for pattern in catalog.patterns_for_line(line.id):
            print(f"       {pattern.id:<8} {pattern.origin} → {pattern.headsign}")


def _print_stops(catalog: Catalog, stops: Sequence[Stop]) -> None:
    if not stops:
        print("Ninguna parada coincide")
    for stop in stops:
        labels = ", ".join(catalog.line(line_id).label for line_id in stop.line_ids)
        print(f"{stop.id:>4}  {stop.name:<36} líneas {labels}")


def _print_arrivals(catalog: Catalog, arrivals: StopArrivals) -> None:
    stop = catalog.stop(arrivals.stop_id)
    print(f"Parada {stop.id} · {stop.name} · {arrivals.generated_at.astimezone(TIMEZONE):%H:%M:%S}")
    if not arrivals.arrivals:
        print("  Sin llegadas previstas")
    for arrival in arrivals.arrivals:
        label = catalog.line(arrival.line_id).label
        towards = arrival.headsign or "sentido desconocido"
        flags = "".join(
            (
                "" if arrival.is_realtime else " · programado",
                " · fin de trayecto" if arrival.terminates else "",
                " · CANCELADO" if arrival.cancelled else "",
            )
        )
        print(
            f"  {label:>3} → {towards:<28} {arrival.minutes:>3} min  {arrival.expected.astimezone(TIMEZONE):%H:%M}{flags}"
        )


def _print_timetable(catalog: Catalog, timetable: LineTimetable) -> None:
    line = catalog.line(timetable.line_id)
    print(f"Línea {line.label} · horario de hoy ({timetable.service_date})")
    if not timetable.directions:
        print("  Sin servicio hoy")
    for direction in timetable.directions:
        span = (
            f"{direction.departures[0]}–{direction.departures[-1]}"
            if direction.departures
            else "sin salidas"
        )
        print(f"  Hacia {direction.headsign} (salidas de {direction.origin}): {span}")
        for period in direction.periods:
            interval = describe_interval(period.interval_min, period.interval_max_min)
            print(f"    {period.first}–{period.last} {interval}")
        for start in range(0, len(direction.departures), DEPARTURES_PER_ROW):
            print("    " + " ".join(direction.departures[start : start + DEPARTURES_PER_ROW]))


def _emit(value: object) -> None:
    print(json.dumps(to_json(value), ensure_ascii=False, indent=2))


async def _record(client: LogronoBusClient, stop_ids: Sequence[str], out_dir: Path) -> None:
    stops_document = await client.get_json(ENDPOINT_STOPS)
    lines_by_stop = {stop.id: stop.line_ids for stop in parse_stops(stops_document)}
    documents: dict[str, object] = {
        "lines.json": await client.get_json(ENDPOINT_LINES),
        "stops.json": stops_document,
    }
    for stop_id in stop_ids:
        documents[f"arrivals-{stop_id}.json"] = await client.get_json(
            ENDPOINT_ARRIVALS.format(stop_id=stop_id),
            params={
                "lines": ",".join(lines_by_stop.get(stop_id, ())),
                "previewMinutes": str(RECORD_PREVIEW_MINUTES),
            },
        )
    await asyncio.to_thread(_write_documents, out_dir, documents)


def _write_documents(out_dir: Path, documents: dict[str, object]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, document in documents.items():
        path = out_dir / name
        path.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"guardado {path}", file=sys.stderr)


async def run(args: argparse.Namespace) -> int:
    async with aiohttp.ClientSession() as session:
        client = LogronoBusClient(session, base_url=args.origen)
        if args.command == "grabar":
            await _record(client, args.paradas, args.salida)
            return EXIT_OK
        provider = LogronoBusProvider(session, client=client)
        catalog = await provider.get_catalog()
        if args.command == "lineas":
            if args.json:
                _emit(catalog)
            else:
                _print_lines(catalog)
        elif args.command == "paradas":
            found = (
                catalog.search(args.buscar)
                if args.buscar is not None
                else [n.stop for n in catalog.nearby(*args.cerca, radius_m=args.radio)]
            )
            if args.json:
                _emit(found)
            else:
                _print_stops(catalog, found)
        elif args.command == "horario":
            timetable = await provider.get_timetable(args.linea)
            if args.json:
                _emit(timetable)
            else:
                _print_timetable(catalog, timetable)
        else:
            arrivals = await provider.get_arrivals(args.parada)
            if args.lineas:
                (selection,) = parse_selection(f"{args.parada}{STOP_SEPARATOR}{args.lineas}")
                arrivals = selection.filter(arrivals)
            if args.json:
                _emit(arrivals)
            else:
                _print_arrivals(catalog, arrivals)
    return EXIT_OK


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return asyncio.run(run(args))
    except LogronoBusError as err:
        print(f"error: {err}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
