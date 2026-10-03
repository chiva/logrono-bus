# Contrato de datos

Python (`logrono_bus`) y TypeScript (`@logrono-bus/core`) implementan la misma normalización. Para
que no se separen:

1. **Ficheros de referencia** en `contracts/fixtures/`:
    - `upstream/`: respuestas reales del Ayuntamiento, recortadas al mínimo (`scripts/trim_fixtures.py`),
      más casos sintéticos para los límites (`arrivals-sintetico-5.json`).
    - `expected/`: la salida canónica (JSON) para cada caso.
    - `manifest.json`: qué caso usa qué ficheros y con qué `now`.
    - `selection.json`: casos válidos e inválidos del formato `p`.
2. `packages/logrono-bus/tests/test_contract.py` y `web/packages/core/test/contract.test.ts`
   recorren el mismo manifiesto. Si cualquiera difiere, su batería falla.
3. **Tipos generados:** `contracts/openapi.json` sale de FastAPI (`just gen`) y de él
   `web/packages/core/src/types.gen.ts`. CI falla si no están al día (`just gen-check`).

## Cambiar la normalización a propósito

1. Cambia Python.
2. `just golden` regenera `expected/`. **Revisa el diff** como cualquier cambio de código.
3. Cambia TypeScript hasta que `pnpm --dir web test` pase.

## Grabar casos nuevos

```bash
uv run logrono-bus grabar 101 100 5 --salida /tmp/grabacion
uv run python scripts/trim_fixtures.py /tmp/grabacion contracts/fixtures/upstream
# añade el caso a contracts/fixtures/manifest.json con su "now"
just golden
```
