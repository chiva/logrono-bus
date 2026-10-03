# 0005. Deducir el sentido sin adivinar

**Estado:** aceptada (2026-10-03)

Las llegadas traen un `directionRef` opaco y a veces vacío. Se comprobó con todas las líneas que
`order` coincide con la posición de la parada en `stops.asc` o `stops.desc`, y que las paradas
compartidas por ambos sentidos están en posiciones distintas. Estrategia
(`providers/logrono/directions.py`):

1. La parada solo está en un sentido de esa línea → ese.
2. `order` coincide con la posición en exactamente un sentido → ese.
3. Un `directionRef` ya visto en una llegada resuelta → el aprendido.
4. Si no, `null`: la interfaz dice «sentido desconocido».

Mandar a alguien en dirección contraria es peor que reconocer la duda.
