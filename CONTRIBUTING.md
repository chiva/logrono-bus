# Cómo contribuir

¡Gracias! Avisos de errores, ideas y PRs son bienvenidos.

## Avisar de un problema

Usa las [plantillas de GitHub](https://github.com/chiva/logrono-bus/issues/new/choose). Si algo se
ve mal en una pantalla concreta, incluye los datos de **Acerca de → Datos de esta pantalla**.

## Entorno

```bash
uv sync               # Python (librería, servicio y herramientas)
uv run just setup     # web, hooks de pre-commit y Chromium para las pruebas
uv run just           # todas las tareas
```

## Antes de abrir un PR

- `uv run just ci` en verde (lo mismo que CI).
- Título del PR en [Conventional Commits](https://www.conventionalcommits.org/es/)
  (`feat(web): …`, `fix(lib): …`): de él salen las versiones y el CHANGELOG.
- Código y comentarios en inglés; todo lo que ve el usuario, en español.
- Pruebas nuevas para el comportamiento nuevo. Umbrales: 90 % Python, 85 % lógica web; las vistas
  se prueban con Playwright.
- Si cambias la normalización, sigue [Contrato de datos](docs/desarrollo/contrato-datos.md): Python
  y TypeScript deben seguir dando lo mismo.
- Si cambias la API, `just gen` y revisa el diff de `contracts/openapi.json`.
- Si cambias la interfaz, `just screenshots` actualiza las capturas de la guía.

## Respeto al servicio del Ayuntamiento

No subas la frecuencia de consulta ni añadas peticiones en bucle. Las pruebas usan los ficheros de
`contracts/fixtures`; solo `just test-live` llama al servicio real, con pocas peticiones.
