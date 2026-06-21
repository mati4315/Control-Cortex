# Guía de Implementación: Control Cortex
> **Proyecto:** Sistema centralizador y dashboard de orquestación para plugins y microservicios de OBS Studio, gestionados con PM2.

Esta guía está pensada para que una IA entienda la arquitectura, el flujo de trabajo y la estructura del proyecto de **Control Cortex**, el panel central de automatización para streaming.

---

## 1. Visión General
**Control Cortex** es un dashboard web que administra múltiples microservicios relacionados con OBS Studio. Cada microservicio vive en su propia carpeta y se ejecuta en segundo plano mediante **PM2**.

### Objetivos principales
1. **Monitoreo en tiempo real:** ver qué servicios están activos, su consumo de CPU/RAM y sus logs en vivo.
2. **Control centralizado:** iniciar, detener y reiniciar cada servicio desde el panel.
3. **Alta dinámica:** registrar nuevos servicios sin tocar el código del dashboard.
4. **Acceso rápido:** abrir el panel web de cada servicio en una nueva pestaña.

### Alcance recomendado
1. Soporte inicial para servicios locales en Windows.
2. Persistencia de la configuración en archivo JSON.
3. Comunicación backend-frontend por REST y WebSocket.
4. Integración con PM2 como capa de orquestación.

---

## 2. Estructura de Directorios Propuesta
Los proyectos se organizan dentro de una carpeta raíz común. **Control Cortex** vive como un proyecto independiente dentro de esa raíz.

```text
Mis plugins OBS/
│
├── Control Cortex/                  <-- Dashboard central
│   ├── backend/
│   │   ├── package.json             (express, ws, pm2, cors)
│   │   ├── services.json            (registro local de servicios)
│   │   └── server.js                (API y control de PM2)
│   └── frontend/
│       ├── index.html               (interfaz web)
│       ├── style.css                (estilos)
│       └── app.js                   (UI y WebSocket)
│
├── TriggerStudio/
├── Modulo de sorteo scraping/
└── Modulo de tiempo y clima/
```

### Convenciones recomendadas
1. Usar `id` único y estable por servicio.
2. Guardar rutas absolutas para evitar ambigüedades en Windows.
3. Mantener nombres consistentes entre carpeta, `name` e `id`.
4. Separar claramente configuración, UI y lógica de control.

---

## 3. Modelo de Servicios (`services.json`)
La lista de microservicios se guarda en un archivo JSON del backend. Cada entrada debería tener, como mínimo, esta forma:

```json
[
  {
    "id": "trigger-studio",
    "name": "TriggerStudio",
    "description": "Control de alertas visuales y sonoras en OBS",
    "directory": "D:/usuario/Desktop/TriggerStudio/server",
    "script": "dist/index.js",
    "env": { "PORT": "2188" },
    "dashboardUrl": "http://localhost:2188",
    "status": "stopped"
  }
]
```

### Campos sugeridos
1. `id`: identificador técnico único.
2. `name`: nombre visible en el dashboard.
3. `description`: resumen corto del servicio.
4. `directory`: carpeta de ejecución.
5. `script`: archivo principal arrancado por PM2.
6. `env`: variables de entorno necesarias.
7. `dashboardUrl`: enlace al panel del servicio, si existe.
8. `status`: estado cacheado o último estado conocido.

### Validaciones mínimas
1. Verificar que `directory` exista.
2. Verificar que `script` exista dentro de la carpeta.
3. Evitar `id` duplicados.
4. Normalizar rutas de Windows antes de guardar.
5. No permitir campos vacíos en datos críticos.

---

## 4. Backend: Servidor de Control (`server.js`)
El backend debe exponer una API REST y un canal WebSocket. Su responsabilidad es leer `services.json`, consultar PM2 y traducir acciones del dashboard a operaciones concretas.

### Funciones principales
1. **API REST**
   - `GET /api/services`: devuelve todos los servicios con su estado real.
   - `POST /api/services`: registra un nuevo servicio.
   - `DELETE /api/services/:id`: elimina un servicio.
2. **Control de procesos**
   - `POST /api/services/:id/start`
   - `POST /api/services/:id/stop`
   - `POST /api/services/:id/restart`
3. **Logs en tiempo real**
   - Conectar a `pm2.launchBus()` y reenviar eventos `log:out`, `log:err` y cambios de estado.

### Reglas importantes
1. No asumir que el estado guardado en JSON es el estado real.
2. Consultar PM2 antes de responder al frontend cuando sea posible.
3. Manejar errores de conexión a PM2 sin romper el servidor.
4. Responder con códigos HTTP claros y mensajes útiles.

### Ejemplo base con PM2
```javascript
const pm2 = require('pm2');

function getProcessStatus(serviceId) {
  return new Promise((resolve) => {
    pm2.connect((err) => {
      if (err) return resolve('unknown');

      pm2.describe(serviceId, (err, description) => {
        pm2.disconnect();

        if (err || !description || description.length === 0) {
          resolve('stopped');
          return;
        }

        resolve(description[0].pm2_env.status);
      });
    });
  });
}

function startProcess(service) {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);

      pm2.start(
        {
          name: service.id,
          script: service.script,
          cwd: service.directory,
          env: service.env,
        },
        (err, apps) => {
          pm2.disconnect();
          if (err) reject(err);
          else resolve(apps);
        }
      );
    });
  });
}
```

### Recomendación de implementación
1. Encapsular lectura y escritura de `services.json` en funciones separadas.
2. Centralizar el manejo de errores.
3. Separar la lógica de PM2 de la lógica HTTP.
4. Emitir eventos WebSocket cuando cambie un proceso.

---

## 5. Frontend: Interfaz Gráfica
La UI debe ser moderna, clara y rápida. Puede usar un estilo oscuro con glassmorphism, pero sin sacrificar legibilidad.

### Secciones principales
1. **Header**
   - CPU global.
   - RAM global.
   - Cantidad de servicios online.
2. **Tarjetas de servicios**
   - Nombre e indicador de estado.
   - CPU y memoria del proceso.
   - Acciones: iniciar, detener, reiniciar.
   - Botón para abrir el panel del servicio.
3. **Consola de logs**
   - Vista tipo terminal para el servicio seleccionado.
   - Diferenciar `stdout` y `stderr`.
4. **Formulario de alta**
   - Nombre.
   - Ruta absoluta.
   - Script principal.
   - Puerto.
   - URL opcional del panel.

### Comportamiento esperado
1. La tarjeta debe actualizarse al cambiar el estado del proceso.
2. Los logs deben seguir al servicio seleccionado.
3. Si un servicio no tiene `dashboardUrl`, ocultar o deshabilitar el botón.
4. Mostrar feedback visible cuando una acción falla.

---

## 6. Seguridad y Robustez
Estas piezas faltan en la versión original y conviene incluirlas desde el inicio.

1. Validar todas las entradas del formulario.
2. Sanitizar rutas y evitar paths inválidos.
3. Evitar sobrescribir servicios con `id` repetidos.
4. Controlar permisos de archivo al editar `services.json`.
5. Registrar errores del backend en un log propio.
6. No exponer el backend a internet sin autenticación.

---

## 7. Mejoras Futuras
1. **Persistencia automática:** ejecutar `pm2 save` y documentar `pm2 startup` para reinicio automático.
2. **Alertas de salud:** notificar cuando un proceso entre en `errored` o se caiga repetidamente.
3. **Servicios remotos:** permitir nodos en otras PCs de la red local.
4. **Editor de `.env`:** modificar variables por servicio desde el dashboard.
5. **Autenticación:** agregar login si el panel va a usarse fuera del entorno local.
6. **Historial de eventos:** guardar reinicios, caídas y acciones manuales.
7. **Filtros y búsqueda:** encontrar servicios por nombre, estado o categoría.

---

## 8. Criterio de Implementación
La primera versión debería priorizar:
1. Carga y guardado de servicios.
2. Start/stop/restart con PM2.
3. Estado en tiempo real.
4. Logs por WebSocket.
5. UI simple pero funcional.

Después se pueden sumar mejoras visuales y funciones avanzadas.
