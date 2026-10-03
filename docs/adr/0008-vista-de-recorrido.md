# 0008. Vista de recorrido con posiciones en tiempo real

**Estado:** aceptada (2026-10-03)

## Contexto

Al tocar una tarjeta se quiere ver por dónde va el autobús. El Ayuntamiento publica posiciones
(`vehicleMonitoring/byLine`), pero con números de vehículo distintos de los de las llegadas.

## Decisión

- Normalización de posiciones en la librería (Python y TypeScript, con casos de referencia
  compartidos) y endpoint `/api/v1/lines/{id}/vehicles` con caché de 10 s.
- La vista (`buildRoute`, `<lb-route>`) se construye solo en TypeScript: es presentación.
- Los minutos se asignan a los autobuses por orden de cercanía a la parada.
- Se muestran N paradas antes de la tuya (ajuste `previas`, 1–12, por defecto 4; menos si no
  caben). El resto de la línea se dibuja como «…» antes y, si la tuya no es la última, después.
  Los autobuses más lejanos conservan su turno en la asignación de minutos y el más cercano de
  ellos se dibuja sobre los «…» iniciales.
- Se consultan las posiciones **solo mientras la vista está abierta**, cada 15 s (la web oficial
  lo hace cada 10 s), y la vista se cierra sola tras un minuto sin tocarla.

## Consecuencias

Es la única consulta periódica nueva al Ayuntamiento; está acotada a una línea y a una vista
abierta. En Home Assistant, la tarjeta pide las posiciones desde el navegador, porque no son
sensores.
