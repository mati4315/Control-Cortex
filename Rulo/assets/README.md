# Rulo / assets

Assets de la mascota de Rulo. Los sirve el backend en `/rulo-assets/` (carpeta montada desde acá).

## Contrato de nombres

Un archivo por estado, con el nombre exacto del estado:

```
idle.svg  thinking.svg  success.svg  warning.svg  error.svg  speaking.svg
```

- Formato: SVG (o PNG reexportado a SVG envuelto si hace falta) con fondo transparente.
- Tamaño: 512x512, contenido centrado con ~6% de margen (el avatar del overlay es un círculo de 58px).
- Estados y cuándo se usan: ver `states.json`.

## Cómo se consume

1. `rulo-bot-overlay.html` pide `/rulo-assets/<mood>.svg` cuando llega un `rulo_bot_message`.
2. Si el archivo no existe o falla la carga, el overlay vuelve solo a la inicial (`avatarLetter`) sin romper nada.
3. La mascota se activa con `showMascot: true` en `rulo-config.json` (o el check del dashboard).

## Estado

Los seis SVG existen (primera version, generada desde el prototipo en CSS de `Rulo/rulo-mascota.html`) y `states.json` esta en `listo: true`. Son reemplazables uno por uno: mientras el archivo respete el nombre y el lienzo, el overlay lo toma solo.

Paleta de la primera version: cuerpo claro con contorno oscuro (`#14181f`), para que se lea sobre cualquier color de acento configurado en el dashboard. Detalles con significado propio: burbuja azul en `thinking`, aviso ambar en `warning`, X rojas en `error`, ondas en `speaking`.
