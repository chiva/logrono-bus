# Seguridad

Si encuentras una vulnerabilidad, **no abras un issue público**. Usa el
[aviso privado de GitHub](https://github.com/chiva/logrono-bus/security/advisories/new). Responderé
en unos días.

Alcance: la web, el servicio (`logrono-bus-api`), la imagen de contenedor y la librería. El
servicio del Ayuntamiento no es parte del proyecto.

Las imágenes se pueden verificar con
`gh attestation verify oci://ghcr.io/chiva/logrono-bus:<versión> --owner chiva` o con `cosign`.
