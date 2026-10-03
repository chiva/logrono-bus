# Tu propio servidor (Docker)

**No hace falta para usar Logroño Bus.** La web pública funciona sola. Montar tu servidor tiene
sentido si:

- tienes **varias pantallas** en casa y quieres que compartan una sola consulta al Ayuntamiento
  (caché común);
- quieres el panel en **texto o JSON** para [widgets de Android](08-widgets-android.md) o sensores
  `rest` de Home Assistant;
- prefieres que tus pantallas no dependan de GitHub Pages.

Funciona en cualquier equipo con Docker: un Raspberry Pi, un NAS, un PC… (imágenes para `amd64` y
`arm64`).

## Ponerlo en marcha

1. Instala [Docker](https://docs.docker.com/get-docker/).
2. Descarga [`compose.yaml`](https://github.com/chiva/logrono-bus/blob/main/docker/compose.yaml)
   en una carpeta.
3. En esa carpeta, ejecuta:

    ```bash
    docker compose up -d
    ```

4. Abre `http://IP-DEL-EQUIPO:8000` desde el móvil (en la misma red).

**Cómo saber que ha funcionado:** ves la misma web que en GitHub Pages. Tus paneles abiertos desde
esta dirección usan automáticamente tu servidor (en **Acerca de** lo verás). La documentación de la
API está en `http://IP-DEL-EQUIPO:8000/docs`.

!!! warning "https y http no se mezclan"
    La web pública (https) **no puede** usar un servidor tuyo con `http://192.168…`: el navegador lo
    bloquea. Abre los paneles desde tu servidor (`http://IP:8000/?p=…`), o publícalo con https
    detrás de un proxy (Caddy, Nginx Proxy Manager, Traefik…).

## Actualizar

```bash
docker compose pull && docker compose up -d
```

## Comprobar que la imagen es la original

Las imágenes están firmadas y llevan la procedencia de su compilación:

```bash
gh attestation verify oci://ghcr.io/chiva/logrono-bus:latest --owner chiva
```

## Ajustes

Todos opcionales, como variables de entorno en `compose.yaml`:

| Variable | Por defecto | Qué hace |
|---|---|---|
| `LOGRONO_BUS_ARRIVALS_TTL_S` | `15` | Segundos que se reutilizan las llegadas de una parada. |
| `LOGRONO_BUS_ARRIVALS_STALE_S` | `120` | Si el Ayuntamiento falla, cuánto tiempo seguir sirviendo los últimos datos. |
| `LOGRONO_BUS_UPSTREAM_RATE_PER_S` | `2` | Peticiones por segundo como máximo al Ayuntamiento. |
| `LOGRONO_BUS_ROOT_PATH` | | Prefijo si lo sirves bajo una ruta (`/bus`). |
| `LOGRONO_BUS_CORS_ORIGINS` | `*` | Orígenes que pueden usar la API desde el navegador. |
| `LOGRONO_BUS_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`… |
| `LOGRONO_BUS_LOG_FORMAT` | `json` | `json` o `text`. |

La lista completa está en la [documentación técnica](https://github.com/chiva/logrono-bus/blob/main/docs/desarrollo/configuracion.md).
