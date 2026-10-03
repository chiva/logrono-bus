# Widgets en Android

**Respuesta corta:** una web (aunque la «instales» en el móvil) **no puede** crear widgets de
Android. Android solo permite widgets a las aplicaciones instaladas desde un APK. Hay tres formas
de tener tus autobuses en la pantalla de inicio sin una aplicación propia:

| Opción | Necesitas | Dificultad |
|---|---|---|
| **Home Assistant Companion** | Home Assistant con la [integración](07-home-assistant.md) | Fácil |
| **HTTP Shortcuts** o **KWGT** | [Tu propio servidor](09-servidor-docker.md) | Media |
| Acceso directo a la web | Nada | Muy fácil (no es un widget: abre el panel) |

!!! tip "Muestra la hora, no los minutos"
    Android decide cada cuánto se refresca un widget para ahorrar batería, y puede tardar varios
    minutos. Un widget que dice «4 min» pero lleva 10 minutos sin refrescarse te engaña; uno que
    dice «18:04» sigue siendo cierto. Siempre que puedas, muestra la **hora de llegada**.

## Con Home Assistant (recomendado)

La aplicación oficial [Home Assistant Companion](https://companion.home-assistant.io/) trae
widgets:

1. Mantén pulsado un hueco de la pantalla de inicio → **Widgets** → **Home Assistant**.
2. Elige **Widget de entidad** y selecciona `sensor.…_proxima_llegada` de tu línea.
3. (Opcional) Con el **widget de plantilla** puedes mostrar varias líneas a la vez:

    ```jinja
    {% set l2 = as_timestamp(states('sensor.ayuntamiento_101_2_manresa_proxima_llegada'), none) %}
    {% set l10 = as_timestamp(states('sensor.ayuntamiento_101_10_manuel_de_falla_proxima_llegada'), none) %}
    2 → Manresa: {{ l2 | timestamp_custom('%H:%M') if l2 else 'sin datos' }}
    10 → M. de Falla: {{ l10 | timestamp_custom('%H:%M') if l10 else 'sin datos' }}
    ```

    Cambia los nombres de los sensores por los tuyos (los ves en **Ajustes → Dispositivos y
    servicios → Logroño Bus**).

## Con tu servidor y HTTP Shortcuts / KWGT

Son dos aplicaciones de Android (en Google Play) que pueden leer una dirección web y mostrar lo que
devuelve:

- **[HTTP Shortcuts](https://http-shortcuts.rmy.ch/)**: crea accesos directos y widgets que llaman a
  una dirección. Gratuita y sencilla: un toque y ves la respuesta.
- **KWGT (Kustom Widget Maker)**: para diseñar widgets a medida (textos, formas, colores). Muy
  flexible, pero lleva un rato aprenderla y algunas funciones son de pago (versión Pro).

Si tienes [tu propio servidor](09-servidor-docker.md), te da el panel en texto plano o JSON:

- Texto con la hora de llegada (recomendado para widgets):
  `http://IP-DEL-SERVIDOR:8000/api/v1/board?p=101-2d.10d&format=text&tiempo=hora`

    ```text
    2 → Manresa · Ayuntamiento: 18:04, 18:12
    10 → Manuel de Falla · Ayuntamiento: 18:07
    ```

- Texto con minutos: el mismo enlace sin `&tiempo=hora`.

    ```text
    2 → Manresa · Ayuntamiento: 4, 12 min
    10 → Manuel de Falla · Ayuntamiento: 7 min
    ```

- JSON: el mismo enlace sin `&format=text`.

Con **HTTP Shortcuts** crea un acceso «Mostrar respuesta» con esa dirección: consulta al tocarlo,
así que los minutos siempre son del momento. Con **KWGT**, usa la fórmula `$wg("URL", txt)$` en un
texto del widget y la versión con `tiempo=hora`, porque KWGT se refresca cuando Android le deja.

## Fuera de casa

El widget solo se actualiza si el móvil **llega** a tu Home Assistant o a tu servidor:

- **Home Assistant:** necesitas acceso remoto (Home Assistant Cloud / Nabu Casa, o tu propio
  dominio o VPN). Si la app Companion ya te funciona fuera de casa, el widget también.
- **Tu servidor:** `http://192.168…` solo funciona con el wifi de casa. Fuera, necesitas una VPN
  (por ejemplo Tailscale o WireGuard) o publicarlo con https.

## Un acceso directo a tu panel

Siempre puedes [añadir el panel a la pantalla de inicio](02-usar-en-el-movil.md): no es un widget,
pero abre tu panel con un toque y funciona en cualquier sitio, sin servidor.

!!! note "¿Y una aplicación de verdad?"
    Un widget nativo exigiría publicar una aplicación Android (APK). Está anotado como posible
    mejora futura; si te interesa, coméntalo en GitHub.
