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

El servidor guarda el ultimo `CONFIG_SNAPSHOT` y se lo envia automaticamente a clientes nuevos.

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
- Necesitamos auth/token para proteger el canal WS?
- Donde desplegamos el relay WS (Node, VPS, Docker, PaaS)?
- Quieren mantener polling HTTP como backup?

---

## Resumen ejecutivo

El sistema ya esta preparado para integracion dinamica real.
Solo falta conectar tu backend de compras para que emita eventos `TRIGGER_BALL` al WebSocket.
Con eso, OBS mostrara automaticamente cada ganador en tiempo real.
