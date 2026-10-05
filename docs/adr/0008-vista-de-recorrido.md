# 0008. Vista de recorrido con posiciones en tiempo real

**Estado:** aceptada (2026-10-03), revisada el 2026-10-05

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
- Se consultan las posiciones **solo mientras la vista está abierta y la página visible**, cada
  15 s (la web oficial lo hace cada 10 s), y la vista se cierra sola tras 15 minutos sin tocarla.
- Mientras un autobús está parado en una parada, el Ayuntamiento suele mandar la siguiente parada
  vacía (12 de 160 posiciones de la línea 9 el 2026-10-05, siempre a menos de 30 m de una
  parada). Ese autobús se dibuja en la parada de su recorrido que tenga a 60 m o menos; si no
  hay ninguna, no se dibuja.
- Si falla una consulta, se mantienen las últimas posiciones con un aviso mientras tengan menos
  de 3 minutos (la misma antigüedad a partir de la cual se descartan).

## Consecuencias

Es la única consulta periódica nueva al Ayuntamiento; está acotada a una línea y a una vista
abierta y visible. Con el cierre a los 15 minutos (antes, un minuto: se cerraba antes de que
llegase el autobús que estabas mirando), una vista olvidada a la vista hace unas 60 consultas.
Cada vez que la página vuelve a verse se consulta en el acto sin reiniciar esos 15 minutos, así
que ocultarla y mostrarla muchas veces puede sumar alguna más. En Home Assistant, la tarjeta pide
las posiciones desde el navegador, porque no son sensores.
