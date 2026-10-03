# 0007. Sitio de la guía con Material for MkDocs

**Estado:** aceptada (2026-10-03)

Material for MkDocs 9.7 es estable; su sucesor, Zensical, seguía en 0.0.x en octubre de 2026. Se
usa Material y se revisará la migración cuando Zensical sea estable (lee el mismo `mkdocs.yml`).

## Revisión (2026-10-03)

Material avisa al compilar de que MkDocs 2.0 romperá plugins y temas. Comprobado:

- MkDocs 2.0 no está publicado (la última es 1.6.1) y `mkdocs-material` 9.7.7 exige `mkdocs<2`,
  así que ni una actualización de Renovate nos llevaría a 2.0 sin cambiar también Material.
- Zensical 0.0.67 (alfa, publica cada pocos días) compila la guía sin cambios
  (`uvx --from zensical zensical build --strict -f mkdocs.yml`).

Se mantiene Material: no se adopta software en alfa para la documentación. Migrar cuando Zensical
publique una versión estable (1.0) o cuando Material deje de recibir correcciones; el cambio se
limita a la dependencia `docs` en `pyproject.toml`, el `justfile` y los workflows `ci.yml` y
`pages.yml`.
