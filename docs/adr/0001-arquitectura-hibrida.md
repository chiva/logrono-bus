# 0001. Arquitectura híbrida: web estática + servidor opcional

**Estado:** aceptada (2026-10-03)

## Contexto

La mayoría de usuarios no va a montar un servidor. Pero varias pantallas en una casa multiplican
las consultas al Ayuntamiento, los widgets de Android necesitan un endpoint sencillo y la API del
Ayuntamiento podría dejar de permitir peticiones desde el navegador (CORS).

## Decisión

- Web estática en GitHub Pages que consulta directamente al Ayuntamiento (`DirectSource`).
- Imagen Docker opcional con API propia, caché compartida y la misma web (`BackendSource`).
- La web elige sola: si hay un servidor compatible en su mismo origen, lo usa.

## Consecuencias

- La normalización existe en Python y TypeScript → [contrato de datos](../desarrollo/contrato-datos.md).
- Una página https no puede usar un servidor `http://` de la red local: se explica en la guía y se
  detecta con un mensaje claro.
- Si el Ayuntamiento retira CORS, la web pública dejaría de funcionar y el servidor seguiría.
