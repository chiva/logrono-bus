# Configuración del servicio

Variables de entorno con prefijo `LOGRONO_BUS_` (o un fichero `.env`). Un valor inválido detiene el
arranque con un mensaje que nombra la variable.

| Variable | Por defecto | Rango | Descripción |
|---|---|---|---|
| `HOST` | `0.0.0.0` | | Interfaz de escucha. |
| `PORT` | `8000` | 1–65535 | Puerto. |
| `ROOT_PATH` | | `/…` | Prefijo detrás de un proxy. |
| `UPSTREAM_URL` | `https://transporteurbano.logrono.es/api/` | URL | Origen de datos. |
| `UPSTREAM_TIMEOUT_S` | `10` | 0–60 | Tiempo máximo por petición. |
| `UPSTREAM_RATE_PER_S` | `2` | 0–20 | Ritmo sostenido máximo hacia el origen. |
| `UPSTREAM_BURST` | `4` | 1–50 | Ráfaga permitida. |
| `BREAKER_FAILURES` | `5` | 1–100 | Fallos seguidos que abren el cortacircuitos. |
| `BREAKER_RESET_S` | `30` | | Pausa antes de volver a probar. |
| `CATALOG_TTL_H` | `6` | | Validez del catálogo (si falla la renovación se sigue usando el anterior). |
| `ARRIVALS_TTL_S` | `15` | 1–300 | Validez de las llegadas de una parada. |
| `ARRIVALS_STALE_S` | `120` | 0–3600 | Margen para servir llegadas caducadas si el origen falla. |
| `CORS_ORIGINS` | `*` | lista con comas | Orígenes permitidos. |
| `WEB_DIR` | (imagen: `/app/web`) | ruta con `index.html` | Web a servir en `/`. |
| `LOG_LEVEL` | `INFO` | | Nivel de log. |
| `LOG_FORMAT` | `json` | `json`, `text` | Formato de log; cada línea lleva `request_id`. |

Un solo proceso a propósito: la caché, la petición única y el límite hacia el origen son por
proceso.
