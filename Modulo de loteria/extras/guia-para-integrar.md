# Guia de Integracion Dinamica - Loteria Ball (OBS + Web)

Este documento deja el proyecto listo para integrarlo con tu web en tiempo real.

## Estado actual del proyecto

Archivos principales:
- `lottery-ball.html`: widget visual para OBS (720x1280).
- `dashboard.html`: panel de control (modos, velocidades, ajustes, disparo manual).
- `server-ws.js`: servidor WebSocket de sincronizacion y relay.
- `iniciar-sync-ws-688.bat`: inicio rapido en Windows con doble click.

Modos soportados:
- `test`: ciclo automatico.
- `manual`: solo dispara cuando se envia evento.
- `dynamic`: escucha compras externas (WS/API polling).

En el dashboard, **Números comprados** consulta las entradas de las loterías activas en Firestore. El botón **Actualizar** vuelve a leer la lista; al pulsar una compra, se vuelve a mostrar su bolilla en el mismo overlay con una trayectoria inversa: empieza arriba a la izquierda, cae y se desplaza hacia la derecha. Esta repetición es visual y no cambia la compra ni el número asignado. Para usarla, guarda el dashboard en modo `manual` o `dynamic`.

El servidor WebSocket mantiene la cola FIFO y entrega un lanzamiento por vez al overlay registrado. El dashboard muestra la bolilla actual y las pendientes, y permite pausar/reanudar la cola, quitar una pendiente, saltar la siguiente o vaciar las pendientes. Estas acciones no cambian las compras. El overlay puede mostrar las próximas cuatro bolillas y el total pendiente; se controla desde **Mostrar próximas bolillas en el overlay** en el dashboard y está activado por defecto. Deshabilitarlo solo oculta el panel, sin afectar los lanzamientos ni la cola.

El servidor comprueba periódicamente que las conexiones WebSocket sigan vivas y vuelve a enviar la bolilla actual cada 12 segundos hasta recibir su confirmación. El overlay reconoce el mismo `queueId` y no duplica una animación que sigue activa; si ya terminó, reenvía `BALL_FINISHED`. Esto recupera confirmaciones perdidas y evita depender de F5 para destrabar la cola.

La animación calcula su avance según el tiempo transcurrido, incluso si el navegador reduce `requestAnimationFrame` cuando la página queda en segundo plano. Con pocos cuadros puede verse menos fluida, pero la bolilla sigue avanzando y la cola no debería quedar esperando a que alguien enfoque la página.

La cola se guarda localmente en `lottery-queue-state.json` (excluido de Git). Si OBS o el servidor se reinician, el overlay recupera la bolilla activa y las pendientes. Si el proceso se interrumpe antes de confirmar que una animación terminó, esa bolilla activa puede volver a lanzarse para no perderla. Una compra recibida cuando OBS está desconectado queda pendiente en el servidor. El WebSocket funciona sin token: cualquier dispositivo que alcance el puerto 688 puede consultar compradores, disparar bolillas y modificar la cola. Mantén ese puerto dentro de tu red privada y no lo publiques en el router.

Si el WebSocket se desconecta justo después de terminar una animación, el overlay conserva temporalmente el `queueId` pendiente de confirmar y reenvía `BALL_FINISHED` al reconectarse. Así el servidor no vuelve a lanzar una bolilla que ya terminó; si la conexión cae durante la animación, el lanzamiento activo puede recuperarse como antes.

En **Ajustes Físicos y Velocidad**, **Espera máxima cuando hay cola** (`QUEUE_STOP_MS`, 3.5 s por defecto, ajustable entre 1 y 25 s) acorta la parada de la bolilla actual cuando hay pendientes. Si la cola se vacía o se pausa, vuelve a regir `STOP_MS`. La lista de compras del dashboard admite búsqueda por número, comprador o nombre de lotería.

En **Ticker / Textos**, los mensajes manuales se alternan de a uno con los dinámicos habilitados. Cada mensaje se desplaza una vez y luego espera un intervalo aleatorio de 2 a 6 minutos; tras un lanzamiento el ticker espera al menos 15 segundos y a que termine la animación. Los mensajes dinámicos muestran el número y el participante de la última bolilla, números ocupados/disponibles y el cierre de participación de loterías activas. El resumen se lee en el servidor con Firebase Admin, se limita a contadores y fechas públicos, se cachea por 30 segundos y agrupa las invalidaciones durante una ráfaga de compras. Firebase guarda `endsAt` como cierre de participación, no hay una fecha de sorteo independiente confirmada; el ticker no presenta ese cierre como horario del sorteo.

Sincronizacion robusta ya implementada:
- `BroadcastChannel` + `localStorage` (mismo navegador/perfil).
- WebSocket para sincronizar entre OBS, incognito y otros programas/perfiles.
- Handshake inicial: el widget pide config y recibe snapshot.

Puerto por defecto:
- `ws://localhost:688`

---

## Como iniciar todo (operacion diaria)

1. Doble click en:
   - `iniciar-sync-ws-688.bat`
2. Abrir `dashboard.html`.
3. Abrir `lottery-ball.html` (navegador u OBS Browser Source).
4. Verificar badge en dashboard:
   - `Sync WS activo` (manual/test) o `Online` (dynamic).

Notas:
- El `.bat` libera el puerto 688 si esta ocupado y luego inicia servidor.
- Si el WS no conecta, se mostrara `Sync WS offline` o `Sync WS error`.

---

## Protocolo de mensajes (web <-> servidor <-> widget/dashboard)

### 1) Disparar animacion
```json
{
  "type": "TRIGGER_BALL",
  "number": 23,
  "name": "Juan Perez"
}
```

### 2) Cambiar modo
```json
{
  "type": "CHANGE_MODE",
  "mode": "manual"
}
```

`mode` permitido: `test`, `manual`, `dynamic`.

### 3) Sincronizar configuracion completa
```json
{
  "type": "CONFIG_SNAPSHOT",
  "source": "dashboard",
  "reason": "local_update",
  "config": {
    "MODE": "manual",
    "WEBSOCKET_URL": "ws://localhost:688",
    "FALL_SPEED": 170,
    "SLIDE_SPEED": 240
  }
}
```

El servidor guarda el ultimo `CONFIG_SNAPSHOT` y se lo envia automaticamente a clientes nuevos, sin `WS_TOKEN`. Si el dashboard publica una URL WebSocket de loopback (`localhost` o `127.0.0.1`) y el overlay está en otra dirección de red, el overlay ignora ese loopback y usa el host de su propia URL (por ejemplo, `ws://192.168.4.100:688`).

### Evitar el bucle de configuración y parpadeo

Con varios dashboards abiertos, reenviar cada `WIDGET_HELLO` a todos provocaba respuestas con modos distintos. El overlay reconectaba al cambiar de modo y repetía el saludo: eso generaba el parpadeo y el estado conectado/desconectado continuo.

El servidor responde los saludos desde su caché sin reenviarlos a los dashboards. Solo solicita configuración cuando todavía no tiene ninguna, con un máximo de una solicitud cada dos segundos. Los cambios explícitos del dashboard siguen propagándose. El overlay mantiene su WebSocket al cambiar entre Prueba, Manual e Integración Web; solo cambia de conexión si cambia el endpoint. Una configuración idéntica no reconstruye el ticker ni vuelve a aplicar estilos. La protección de URLs de loopback se aplica también a BroadcastChannel y localStorage.

Verificación aislada: `node --test tests/config-sync.test.js`. Las pruebas ejecutan los handlers reales con red, disco de estado y Firestore simulados, sin enviar bolillas ni alterar compras. Al desplegar cambios de `server-ws.js`, reiniciar únicamente el proceso `modulo-de-loteria` de PM2; recargar una vez las páginas del overlay para cargar también el JavaScript nuevo.

**Solución confirmada por el usuario — 2026-11-08:** después de aplicar el arreglo, el usuario confirmó que funcionó. Antes del reinicio se observaron 91 saludos `WIDGET_HELLO` en 2,5 segundos y respuestas de dashboards con modos distintos. Después del reinicio de `modulo-de-loteria`, una observación de 30 segundos registró 15 estados de cola, todos con el overlay conectado, cero desconexiones y cero alternancias de estado. Las cuatro pruebas de regresión pasaron.

Para conservar esta solución, no volver a reenviar los saludos a todos los dashboards cuando el servidor ya tiene configuración, ni reconectar el overlay solo porque cambia `MODE`. Si el síntoma reaparece, comprobar primero el volumen de `WIDGET_HELLO` y `CONFIG_SNAPSHOT` y los modos enviados por cada panel; cambiar el token no corrige este bucle.

### Configuración compartida entre localhost y Tailscale

Los ajustes operativos del dashboard viven en `lottery-config-snapshot.json`, propiedad de `server-ws.js`; el archivo se actualiza de forma atómica y está excluido de Git. Los paneles leen la copia del servidor al conectarse, y los cambios se propagan al resto de paneles y al overlay. El navegador conserva solo una copia de respaldo. Los tokens de configuraciones antiguas se descartan y nunca viajan en las nuevas instantáneas.

`WEBSOCKET_URL` se calcula para cada cliente y no forma parte de la configuración compartida: OBS y páginas HTTP usan el WebSocket local del módulo; paneles abiertos por Tailscale HTTPS usan el proxy seguro `/api/lottery-ws` de Cortex. El proxy acepta solo conexiones del mismo origen y conecta a la dirección local configurada en Cortex. Las preferencias de los paneles de Cortex se guardan en `cortex-home.json` y se sincronizan mientras Inicio está abierto.

### 4) Consultar compras y relanzar una bolilla

El dashboard envía `REQUEST_PURCHASED_ENTRIES` por WebSocket. El servidor consulta Firestore y responde por esa misma conexión con `PURCHASED_ENTRIES` (o `PURCHASED_ENTRIES_ERROR`). La respuesta incluye número, nombre, avatar y lotería y no requiere token en esta instalación. El clic de relanzamiento envía `TRIGGER_BALL` con `direction: "leftToRight"` y un `eventId` nuevo para que una repetición manual de la misma compra no se descarte como duplicada.

---

## Integracion con tu web (recomendada)

## Opcion A (recomendada): WebSocket push

Cuando se confirma una compra en tu backend:
1. Tu backend envia `TRIGGER_BALL` al servidor WS.
2. El servidor WS hace broadcast.
3. Widget en OBS dispara la animacion.

Ventajas:
- tiempo real real (sin polling),
- sincroniza multiples instancias,
- tambien sincroniza modo/config.

### Ejemplo minimo desde Node (cliente emisor)
```js
const WebSocket = require("ws");
const ws = new WebSocket("ws://localhost:688");

ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "TRIGGER_BALL",
    number: 14,
    name: "Matias Moreira"
  }));
  ws.close();
});
```

## Opcion B: API polling (fallback)

`lottery-ball.html` soporta polling HTTP cada 3s con `API_URL`.
Respuesta esperada:
```json
{
  "id": "compra_10492",
  "number": 14,
  "name": "Matias Moreira"
}
```

Se usa `id`/`timestamp` para evitar repetir la misma animacion.

---

## Checklist para pasar a produccion

1. Definir URL WS publica segura (`wss://...`) o tunel interno.
2. Configurar `WEBSOCKET_URL` en dashboard.
3. Verificar que backend emite `TRIGGER_BALL` en cada compra confirmada.
4. Confirmar que OBS recibe `CONFIG_SNAPSHOT` al reconectar.
5. Probar escenarios:
   - dashboard en manual + OBS recargando,
   - dashboard en dynamic + compras reales,
   - reconexion WS luego de caida de red.

---

## Preguntas concretas para el desarrollador web

- Podemos publicar un endpoint WS (idealmente `wss`) para emitir eventos de compra?
- El backend puede emitir `TRIGGER_BALL` al confirmar pago?
- El canal de esta instalación está abierto sin token; cualquier cliente que alcance el puerto 688 puede consultar compras y controlar la cola.
- Donde desplegamos el relay WS (Node, VPS, Docker, PaaS)?
- Quieren mantener polling HTTP como backup?

---

## Resumen ejecutivo

El sistema ya esta preparado para integracion dinamica real.
Solo falta conectar tu backend de compras para que emita eventos `TRIGGER_BALL` al WebSocket.
Con eso, OBS mostrara automaticamente cada ganador en tiempo real.
