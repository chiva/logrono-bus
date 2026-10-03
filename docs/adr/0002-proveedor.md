# 0002. Proveedor de datos intercambiable

**Estado:** aceptada (2026-10-03)

La concesión del autobús urbano se licita de nuevo con inicio previsto en 2027 y el origen de
datos puede cambiar. Todo consumidor depende del protocolo `TransitProvider` y del modelo de
dominio; `LogronoBusProvider` es la única implementación. Un origen nuevo (p. ej. GTFS-RT) sería
otro proveedor sin cambiar enlaces, API ni sensores de Home Assistant.
