# La API del Ayuntamiento (origen)

No documentada ni con licencia publicada. Todo lo de aquí se ha comprobado en vivo
(2026-10-03); el job diario `upstream-contract.yml` avisa si cambia.

Base: `https://transporteurbano.logrono.es/api/` (de `/env.js` de la web oficial). Sin
autenticación. `access-control-allow-origin: *`.

| Endpoint | Uso |
|---|---|
| `GET linesDiscovery/lines` | Líneas con `stops.asc` / `stops.desc` ordenadas, formas del recorrido (~284 KB), color `rgba()`. |
| `GET linesDiscovery/stops` | 256 paradas `{id, name, lat, lng, status, lines}`. |
| `GET estimatedTimetable/byStop/{id}?lines=…&previewMinutes=60` | Llegadas. |
| `GET vehicleMonitoring/byLine/{línea}` | Posiciones de los autobuses (vista de recorrido). |
| `GET productionTimetable/byLine/{línea}` | Horario de hoy: salidas y frecuencias por sentido (~2 KB). |

## Rarezas

- **`lines` es obligatorio**; sin él la respuesta está vacía.
- **Si pides una línea que no pasa por la parada**, devuelve vehículos de otras líneas. Por eso
  siempre se piden las líneas reales de la parada (del catálogo) y se filtra en cliente.
- **Sin orden**: hay que ordenar por `expectedArrivalTime`.
- **Tiempo real vs horario**: `vehicleRef` con valor y `arrivalStatus: "NO_REPORT"` = autobús
  localizado; `vehicleRef: ""` y `"scheduled"` = horario (y `directionRef` puede venir vacío).
- `predictionInaccurate` viene `true` en prácticamente todas las predicciones en tiempo real: se
  expone como `is_approximate` pero la interfaz no lo destaca (sería ruido).
- **`directionRef`** es un código opaco (`"320"`, `"321"`) que no aparece en el catálogo.
- **`order`** es la posición (base 1) de la parada en el recorrido del autobús: coincide en todos
  los casos con la posición en `stops.asc` o `stops.desc`. Las paradas compartidas por ambos
  sentidos (cabeceras, bucle de la B2) están en posiciones distintas en cada uno. Ver
  [ADR 0005](../adr/0005-sentido.md).
- Identificadores: enteros en el catálogo, texto en llegadas, con ceros a la izquierda en
  `vehicleMonitoring` (`"0127"`). Se normalizan a texto sin ceros.
- Nombres de línea `"2-YAGÜE-VAREA"`, `"B3-LARDERO-EL CAMPILLO"`: etiqueta antes del primer guion.
- **`vehicleMonitoring/byLine/{línea}`** (posiciones, se usa en la vista de recorrido):
    - `directionRef` es `"Ida"` o `"Vuelta"`: **Ida = `stops.asc`, Vuelta = `stops.desc`**
      (comprobado con 19 autobuses de las líneas 1, 2, 5 y 10).
    - `nextStopRef` con ceros a la izquierda (`"0128"`) y a veces vacío.
    - `locationRecordedAtTime` es UTC correcto; **`nextStop*ArrivalTime` son horas locales
      marcadas como UTC**: no se leen.
    - **El número de vehículo no coincide** con el `vehicleRef` de las llegadas (`8348` frente a
      `88` para el mismo servicio). Para poner minutos a cada autobús se empareja por orden: el
      más cercano a la parada con la llegada en tiempo real más próxima.
- **`productionTimetable/byLine/{línea}`** (horario, desde 2026-10-04):
    - Solo el día de hoy. `frequenciesByDirection` y `passesByDirection` usan `"Ida"`/`"Vuelta"`
      (las mismas que las posiciones); `frequencies` y `passes` mezclan ambos sentidos y no se
      leen.
    - Cada franja trae `firstPass`, `lastPass`, `intervalMinutes` y a veces
      `intervalMinutesMax` (frecuencia variable). Las horas pueden venir sin cero (`"6:30"`).
    - **Son salidas desde la primera parada de cada sentido**, no horas de paso por cada parada:
      la llegada programada a la cabecera coincide con la salida publicada (línea 2, Manresa,
      09:00). Lo comprueba a diario la prueba en vivo.
    - Las listas de salidas incluyen refuerzos que la frecuencia no refleja (línea 10, Vuelta:
      15:25 y 15:55 entre salidas «cada 30 min»).
    - Una línea sin servicio hoy responde con listas vacías.
- `GET estimatedTimetable/byLine/{línea}?previewMinutes=…` responde (200), con el mismo formato
  que `byStop`; según notas de julio de 2026, trae las llegadas a **todas** las paradas de la
  línea en una sola petición. No comprobado con servicio (de noche viene vacío) y no se usa;
  podría servir para emparejar mejor minutos y autobuses en el recorrido.
- `GET vehicleMonitoring/all` existe, pero la mayoría de filas traen `lineRef` y
  `publishedLineName` como `"[object Object]"` (54 de 57 el 2026-10-04): un error de
  serialización del servidor. Por eso se usa siempre `byLine`.
- `/env.js` de la web oficial publica su configuración, entre ella `VM_POLL_INTERVAL_MS: "10000"`
  (la web oficial pide posiciones cada 10 s). Si cambia la base de la API, también cambiará ahí.
- Hay un OpenTripPlanner (`/otp/routers/default/index/graphql`) solo con horarios.

## Buen uso

User-Agent identificativo, una petición por parada (todas sus líneas), 30 s entre refrescos en la
web, caché de 15 s y límite de 2 peticiones/s en el servidor, cortacircuitos ante fallos. Los
horarios se piden como mucho una vez por línea y día, y solo para líneas sin autobús próximo o
cuando se abre la vista de horario. Si esa petición falla, el panel web no la repite hasta el día
siguiente y la librería (servidor, Home Assistant) espera 15 minutos antes de volver a intentarlo.
