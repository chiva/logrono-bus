# 0010. «Cerca de mí»: las llegadas de la parada en la que estás

**Estado:** aceptada (2026-11-11)

## Contexto

En la parada, para saber si viene un autobús había que crear un panel: asistente, buscar la
parada, elegir líneas y abrirlo. Se quiere hacer con un toque desde la portada.

## Decisión

- Vista propia en `./#cerca` (`<lb-near-me>`), no un panel nuevo: busca tu ubicación **cada vez
  que se abre** y con **📍 Volver a ubicar**, así que un marcador o el acceso directo de la app
  (`shortcuts` del manifiesto) sirven en cualquier parada. Pide una posición nueva
  (`maximumAge: 0`): una de hace un minuto puede ser de la parada anterior.
- Paradas: la más cercana a menos de 600 m y las que estén a 120 m o menos **de esa parada** (no
  de ti: el error del GPS te mueve a ti, no a las paradas), como mucho 3, de la más cercana a la
  más lejana. Así entra la de enfrente: en los datos de referencia, Ayuntamiento 100/101 están a
  66 m y Hospital San Pedro 35/133 a 117 m; la siguiente parada de la misma calle (Ayuntamiento 2)
  queda a 172 m.
- Se muestran **todas las líneas** de esas paradas con el `<logrono-bus-board>` de siempre, con
  los ajustes de aspecto del dispositivo. Las tarjetas llevan el nombre de la parada y el destino,
  así que las dos aceras no se confunden.
- La ubicación no se guarda ni va en el enlace: se usa una vez y se olvida. **✎ Guardar como
  panel** abre el asistente con esas paradas para convertirlas en un panel normal (ADR 0003).

## Consecuencias

Ninguna consulta periódica nueva al Ayuntamiento: la vista refresca cada 30 s, como un panel de
hasta 3 paradas, y pide los horarios con la misma regla (ADR 0009). No hay nada que portar a
Python: es presentación. Si la ubicación es imprecisa (más de ± 100 m) se avisa, porque la parada
elegida puede no ser la tuya.
