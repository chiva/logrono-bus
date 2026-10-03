# 0004. Sin base de datos ni cuentas

**Estado:** aceptada (2026-10-03)

El estado de un panel cabe en su URL; las preferencias del dispositivo, en `localStorage`. No hay
datos personales que custodiar, el servidor no tiene estado persistente (contenedor de solo
lectura) y cualquier pantalla reproduce un panel con su enlace.
