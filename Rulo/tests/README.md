# Rulo / tests

Pruebas de la interfaz de Rulo sin abrir el navegador: cargan cada HTML con jsdom, simulan `fetch` y `WebSocket` y verifican el DOM real (nombre del bot, estados, filtros, limpieza, links).

## Correr

```bash
cd "D:/plugins para mi OBS/Rulo/tests"
npm install jsdom      # una sola vez (node_modules esta ignorado por git)
node rulo-ui-tests.js        # interfaz de Rulo (35 pruebas)
node panel-url-test.js       # panel Control Cortex servido en vivo (4 pruebas)
```

`panel-url-test.js` necesita el backend levantado: jsdom carga `http://127.0.0.1:4000/` con `app.js` real y mockea las respuestas (`/api/cortex-base-url` devuelve una IP ficticia) para comprobar que las URLs que se copian para OBS se arman con la base detectada y que la tarjeta no se duplica.

Salida esperada: `35/35 pruebas OK` (o el total actual). Cualquier `FAIL` imprime el valor real entre `->`.

## Que cubre

- `rulo-bot-overlay.html`: modo preview, mood del query, nombre desde la configuracion, payload que intenta pisar el nombre, config en vivo, mascota sin asset.
- `rulo-chat-historial.html`: render, nombre dinamico, badges de plataforma, contador, chip WS/P2P, filtros (texto, plataforma, sin respuesta), limpieza en dos pasos.
- `rulo-dashboard.html`: campo de mascota, selector de estados, nombre, links, preview que sigue el estado.
- `rulo-mascota.html`: botones de estado, swatches, overlay embebido.

No reemplaza la prueba real en Brave/OBS: el destacado P2P contra `featured.html` y la reproduccion en Spotify siguen necesitando la extension cargada.
