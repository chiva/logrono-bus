# API HTTP (`/api/v1`)

Documentación interactiva en `/docs` de cada servidor; el contrato está en
[`contracts/openapi.json`](../../contracts/openapi.json). Respuestas JSON con el mismo formato que
la librería (`logrono_bus.to_json`). Errores en `application/problem+json` (RFC 9457); los tipos
están explicados en la [guía](../guia/errores.md).

| Ruta | Respuesta |
|---|---|
| `GET /api/v1/catalog` | Catálogo completo (`Cache-Control: max-age=3600`). |
| `GET /api/v1/lines`, `/lines/{id}` | Líneas; una línea con sus sentidos. |
| `GET /api/v1/lines/{id}/vehicles` | Posición de cada autobús de la línea (caché de 10 s; las de más de 3 min se descartan). |
| `GET /api/v1/lines/{id}/timetable` | Horario de hoy: salidas desde la cabecera de cada sentido y frecuencia por franjas (una petición al Ayuntamiento por línea y día). |
| `GET /api/v1/stops?q=&limit=` | Búsqueda sin tildes; sin `q`, todas. |
| `GET /api/v1/stops/nearby?lat=&lon=&radius_m=&limit=` | Paradas cercanas con distancia. |
| `GET /api/v1/stops/{id}` | Parada y sentidos que pasan. |
| `GET /api/v1/stops/{id}/arrivals?lines=2d.5a` | Llegadas (filtro opcional con la sintaxis de `p`). Cabeceras `Age`, `X-Cache: miss\|hit\|stale`. |
| `GET /api/v1/board?p=…&limit=3&format=json\|text&orden=seleccion\|linea\|llegada&tiempo=minutos\|hora` | Tarjetas de un panel, en el orden pedido; `text` para widgets, con minutos o con la hora de llegada. |
| `GET /api/v1/health` | Versión, `api_version` y estado del origen. |
| `GET /livez`, `/readyz`, `/metrics` | Operación (no aparecen en OpenAPI). |

`api_version` sube solo con cambios incompatibles en `/api/v1`; la web la comprueba antes de usar un
servidor.
