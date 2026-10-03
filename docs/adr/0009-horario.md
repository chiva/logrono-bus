# 0009. Horario de la línea

**Estado:** aceptada (2026-10-04)

## Contexto

Sin autobuses próximos, una tarjeta decía solo «Sin llegadas próximas»: no distinguía «aún no ha
empezado», «ya ha terminado» y «hoy no hay servicio». La API publica el horario del día
(`productionTimetable/byLine`), que se encontró revisando un intento anterior de integración.

## Decisión

- El horario se modela en la librería (Python y TypeScript, con casos de referencia comunes):
  `LineTimetable` → `DirectionTimetable` por sentido (salidas y franjas) y `service_status`, que
  dice si la línea aún no ha empezado, está en servicio (con su frecuencia), ha terminado o no
  tiene servicio hoy.
- **Las horas son salidas desde la primera parada de cada sentido.** No se estima la hora de paso
  por la parada del usuario: no hay datos para hacerlo bien. La interfaz lo dice («Salidas de
  Artesanos… A Ayuntamiento el autobús pasa unos minutos después»). La prueba diaria en vivo
  comprueba esta lectura con las llegadas programadas a la cabecera.
- Una salida en el minuto actual cuenta todavía como «próxima».
- **Como mucho una petición por línea y día**: caché por fecha local en la librería, en el
  navegador (`localStorage`) y en el panel. Solo se pide para líneas cuya tarjeta no tiene
  autobús próximo o al abrir la vista de horario.
- Vista «Horario» dentro de la vista de recorrido; mientras se ve, no se piden posiciones. Si la
  tarjeta no tiene autobús próximo, se abre directamente en el horario.
- En Home Assistant, atributos `servicio`, `primera_salida`, `ultima_salida`, `proxima_salida`,
  `frecuencia_min`, `frecuencia_max_min` y `salidas_desde`. Un fallo del horario nunca deja los
  sensores no disponibles.

## Consecuencias

Nueva consulta al Ayuntamiento, acotada a una por línea y día. Si la API deja de publicar
horarios, las tarjetas vuelven a decir «Sin llegadas próximas» y nada más se rompe.
