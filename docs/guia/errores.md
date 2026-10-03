# Errores del servidor

Esta página explica los errores que puede devolver un servidor de Logroño Bus
(`application/problem+json`, [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)). Cada error tiene
un `type` que apunta a su sección aquí.

## parada-no-encontrada

`404`: la parada pedida no existe (o ha desaparecido tras un cambio de líneas). Revisa el número.

## linea-no-encontrada

`404`: la línea pedida no existe.

## seleccion-no-valida

`400`: el parámetro `p` está mal formado. Formato en
[Crear tu panel](03-crear-tu-panel.md#ejemplos-junto-al-ayuntamiento).

## peticion-no-valida

`422`: algún parámetro tiene un valor fuera de rango; el campo `errors` dice cuál.

## origen-no-disponible

`503`: el servicio del Ayuntamiento no responde. La cabecera `Retry-After` dice cuándo reintentar.
Mientras tanto, si hay datos recientes en caché, el servidor los sirve en lugar de este error.

## origen-cambiado

`502`: el servicio del Ayuntamiento ha cambiado de formato y hace falta actualizar Logroño Bus.

## error-interno

`500`: un fallo inesperado. Avisa en GitHub con el `request_id` de la respuesta.
