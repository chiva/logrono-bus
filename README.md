<p align="center">
  <img src="web/apps/pwa/public/icon.svg" width="96" alt="" />
</p>

<h1 align="center">Logroño Bus</h1>

<p align="center">
  <strong>¿Cuánto le falta a tu autobús?</strong> Estimaciones de paso de los autobuses urbanos de
  Logroño en el móvil, en una pantalla de casa (Echo Show, Meta Portal) o en Home Assistant.
</p>

<p align="center">
  <a href="https://chiva.github.io/logrono-bus/">Abrir la web</a> ·
  <a href="https://chiva.github.io/logrono-bus/guia/">Guía</a> ·
  <a href="https://github.com/chiva/ha-logrono-bus">Integración para Home Assistant</a>
</p>

<p align="center">
  <img src="docs/guia/img/echo-show-5-auto.png" width="480" alt="Panel en modo pantalla en un Echo Show 5" />
</p>

> **Proyecto no oficial.** No está relacionado con el Ayuntamiento de Logroño ni con la empresa de
> autobuses. Usa el servicio web público del Ayuntamiento.

## Qué ofrece

- **Panel web**: elige paradas cercanas (ubicación, búsqueda o mapa), líneas y sentido. Tarjetas
  con el color oficial de cada línea, minutos hasta el próximo autobús y los siguientes.
- **Modo pantalla** para Echo Show, Portal, tablets y monitores: todo a la vista sin desplazarse,
  reloj, se actualiza solo y aguanta días encendido.
- **Aspecto a tu gusto**: 5 temas, tamaño de letra, intensidad del color, tipografía muy legible y
  aviso visual cuando el autobús está a N minutos. Todo viaja en el enlace del panel.
- **Compartir con QR** para llevar un panel a otra pantalla.
- **Home Assistant**: sensores por línea y sentido ([ha-logrono-bus](https://github.com/chiva/ha-logrono-bus)),
  y desde ahí widgets de Android.
- **Servidor opcional** (Docker, amd64/arm64): caché compartida y panel en JSON/texto para widgets.

Sin cuentas, sin anuncios, sin estadísticas.

## Empezar

| Quiero… | Ve a |
|---|---|
| Usarlo ya | [chiva.github.io/logrono-bus](https://chiva.github.io/logrono-bus/) |
| Ponerlo en un Echo Show o un Portal | [Guía: Echo Show](docs/guia/05-echo-show.md) · [Portal](docs/guia/06-portal.md) |
| Sensores en Home Assistant | [Guía: Home Assistant](docs/guia/07-home-assistant.md) |
| Un widget en Android | [Guía: widgets](docs/guia/08-widgets-android.md) |
| Mi propio servidor | [Guía: Docker](docs/guia/09-servidor-docker.md) |

## Estructura

```text
packages/logrono-bus/   Librería Python (PyPI): cliente, modelo, normalización, tarjetas
services/api/           Servicio FastAPI: caché, /api/v1, sirve la web
web/packages/core/      Gemelo TypeScript de la librería + fuentes de datos + URL del panel
web/packages/board/     Componentes Lit <logrono-bus-board> y <lb-card>
web/apps/pwa/           La web (PWA)
contracts/              OpenAPI y ficheros de referencia compartidos por Python y TypeScript
docs/guia/              Guía de usuario (publicada en /guia/)
docs/desarrollo/        Documentación técnica · docs/adr/ Decisiones de arquitectura
docker/                 Imagen y compose
```

Más en [Arquitectura](docs/desarrollo/arquitectura.md).

## Desarrollo

Requisitos: [uv](https://docs.astral.sh/uv/), Node 24 con corepack, Docker (opcional).

```bash
uv sync && uv run just setup   # dependencias, hooks y navegador de pruebas
uv run just                    # lista de tareas
uv run just ci                 # lo mismo que CI: lint, tipos, tests, contratos, docs, e2e
```

Lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir un PR.

## Licencia

[MIT](LICENSE). Tipografía Atkinson Hyperlegible: SIL OFL. Mapas: © colaboradores de OpenStreetMap.
