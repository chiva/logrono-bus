# Publicar versiones

Todo lo hace `.github/workflows/release-please.yml` a partir de commits con
[Conventional Commits](https://www.conventionalcommits.org/es/) (el título del PR se valida).

| Componente | Ruta | Etiqueta | Se publica en |
|---|---|---|---|
| Librería | `packages/logrono-bus` | `logrono-bus-vX.Y.Z` | PyPI (trusted publishing, con atestaciones) |
| Aplicación | resto del repo | `app-vX.Y.Z` | GHCR `ghcr.io/chiva/logrono-bus` (amd64+arm64, SBOM, procedencia, firma cosign) y GitHub Pages (web + guía) |

1. release-please abre un PR por componente con el CHANGELOG y la versión (y re-bloquea `uv.lock`).
2. Al fusionarlo, el mismo workflow publica.

## Configuración única (manual)

- **PyPI**: crear el proyecto `logrono-bus` con *trusted publisher* → repo `chiva/logrono-bus`,
  workflow `release-please.yml`, entorno `pypi`.
- **GitHub**: entorno `pypi`; Pages con origen «GitHub Actions»; etiqueta `upstream-drift`.
- **Integración HA**: tras publicar una versión de la librería, Renovate abre un PR en
  `ha-logrono-bus` que actualiza `manifest.json`.
