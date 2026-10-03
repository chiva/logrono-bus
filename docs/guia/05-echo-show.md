# Echo Show

El **modo pantalla** está pensado para dejar el panel siempre a la vista: sin menús, con letras
grandes, reloj, y todas las tarjetas a la vez sin tener que desplazarse. Se ha probado a la
resolución del **Echo Show 5 de 2.ª y 3.ª generación** (5,5″, 960×480, descontando la barra de
Silk) y del **Echo Show 8** (1280×800).

!!! note "Navegadores antiguos"
    La web está compilada para funcionar en navegadores basados en Chrome 80 o posterior, como el
    Silk de los Echo Show con Fire OS 7. Si en tu Echo Show algo se ve raro, abre **Acerca de →
    Datos de esta pantalla** y comparte lo que aparece (incluye la versión del navegador).

![Echo Show 5](img/echo-show-5-auto.png){ width="480" }

## Paso 1: prepara el enlace

1. En el móvil o el ordenador, [crea tu panel](03-crear-tu-panel.md).
2. En el paso 3, toca **📺 Modo pantalla**.
3. Toca la pantalla → aparece una barra abajo. Si quieres, ajusta el aspecto (**Ajustes**); un
   tamaño de texto de **110–130 %** se lee bien a un par de metros en un Echo Show 5, y el orden
   **«El que llega antes, primero»** pone siempre arriba a la izquierda el autobús que tienes que
   coger.
4. Copia el enlace (en el panel: **🔗 Compartir → Copiar**). Será algo así:
   `https://chiva.github.io/logrono-bus/?v=1&p=101-2d.10d&modo=kiosko`

!!! tip "Enlace corto"
    En el Echo Show escribir es incómodo. Cuantas menos paradas y ajustes, más corto el enlace. Una
    alternativa es guardarlo como favorito una vez y abrirlo siempre desde favoritos.

## Paso 2: ábrelo en el Echo Show

1. Di **«Alexa, abre Silk»** (Silk es el navegador del Echo Show).
2. Toca la barra de direcciones, escribe el enlace y pulsa Ir.
3. Toca el **☆** para guardarlo en **favoritos**: la próxima vez solo tendrás que abrir Silk y
   tocar el favorito.

**Cómo saber que ha funcionado:** ves tus tarjetas con el reloj arriba a la derecha y, abajo,
«Actualizado hace X s».

## Que no se vaya de la pantalla

El Echo Show vuelve a su pantalla de inicio al cabo de un rato. Opciones, de más sencilla a más
completa:

1. **Abrirlo por voz.** Algunas skills de Alexa (por ejemplo, las de tipo «abrir página web»)
   permiten abrir una dirección con una frase. Combínalo con una **rutina de Alexa** («Alexa,
   autobuses»).
2. **Ajustes del Echo Show:** en *Ajustes → Pantalla de inicio y reloj* desactiva el contenido
   rotativo para que, al volver, moleste menos.
3. **Home Assistant:** si usas Home Assistant con un panel en el Echo Show, puedes integrar el
   panel ahí (ver [Home Assistant](07-home-assistant.md)).

!!! warning "Lo que no depende de nosotros"
    Amazon cambia el comportamiento de Silk con las actualizaciones. Si un truco deja de funcionar,
    mira las [preguntas frecuentes](12-preguntas-frecuentes.md) o abre un aviso en GitHub.

## Lo que hace el modo pantalla por ti

- Se actualiza cada **30 segundos** y pausa cuando la pantalla no está a la vista.
- Si el Echo Show «congela» la página y luego vuelve, lo detecta, actualiza al momento y te lo dice.
- Se recarga sola cada 6 horas (solo si hay conexión), para no acumular problemas de memoria.
- Si no hay datos nuevos durante más de minuto y medio, lo indica abajo.
- Toca arriba para ver **Ajustes**, **Pantalla completa** y **Salir del modo pantalla**.
