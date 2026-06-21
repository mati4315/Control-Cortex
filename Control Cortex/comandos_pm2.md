# Guía Completa de Comandos PM2



ejemplo el que mas usaria yo seria para saber el cpu el 

npx pm2 list

y para la memoria Ram
npx pm2 monit


Esta guía contiene la lista de comandos soportados por **PM2**, organizados por categoría para facilitar la administración de tus microservicios y aplicaciones de Node.js (como **Control Cortex** y el **Módulo de Tiempo y Clima**).

---

## 1. Gestión Básica de Procesos

Estos comandos te permiten controlar el ciclo de vida de tus aplicaciones.

| Comando | Descripción | Ejemplo |
| :--- | :--- | :--- |
| `pm2 start <script\|config>` | Inicia una aplicación (archivo `.js`, `.json`, script de shell, etc.). | `pm2 start server.js --name "clima"` |
| `pm2 stop <id\|name\|all>` | Detiene un proceso en ejecución sin eliminarlo de la lista. | `pm2 stop 0` / `pm2 stop all` |
| `pm2 restart <id\|name\|all>` | Detiene y vuelve a iniciar un proceso. | `pm2 restart "modulo-clima"` |
| `pm2 reload <id\|name\|all>` | Recarga la aplicación con tiempo de inactividad cero (Zero-downtime - requiere modo cluster). | `pm2 reload all` |
| `pm2 delete <id\|name\|all>` | Detiene un proceso y lo elimina de la lista de PM2. | `pm2 delete 0` / `pm2 delete all` |

### Opciones Comunes al Iniciar (`pm2 start`)
* `--name <nombre>`: Asigna un nombre personalizado al proceso.
* `--watch`: Reinicia el proceso automáticamente cuando cambian los archivos del directorio.
* `--max-memory-restart <200M\|1G>`: Reinicia automáticamente si el proceso supera cierta cantidad de memoria.
* `--env <name>`: Carga variables de entorno específicas (ej: `--env production`).
* `--arg1 --arg2`: Pasa argumentos adicionales al script.

---

## 2. Monitoreo, Estado y Diagnóstico

Comandos para verificar qué procesos están activos y examinar su comportamiento.

| Comando | Descripción | Ejemplo |
| :--- | :--- | :--- |
| `pm2 list` (o `pm2 l` / `pm2 status`) | Muestra una tabla con todos los procesos registrados, su estado, CPU y memoria. | `pm2 list` |
| `pm2 show <id\|name>` | Muestra información detallada de un proceso específico (rutas de logs, versión, etc.). | `pm2 show 0` |
| `pm2 monit` | Abre un panel interactivo en tiempo real en la consola con uso de CPU/RAM y logs en vivo. | `pm2 monit` |

### Gestión de Logs (Registros)
Los logs de salida estándar (`stdout`) y errores (`stderr`) se almacenan automáticamente.

* `pm2 logs`: Muestra los logs en tiempo real de todos los procesos.
* `pm2 logs <id\|name>`: Filtra los logs en tiempo real para un proceso específico (ej: `pm2 logs 0`).
* `pm2 logs --lines <N>`: Muestra las últimas `N` líneas de logs (ej: `pm2 logs --lines 100`).
* `pm2 flush`: Vacía (borra) todos los archivos de logs guardados.

---

## 3. Persistencia y Ciclo de Vida del Servidor

Estos comandos garantizan que tus aplicaciones sobrevivan a reinicios inesperados del sistema o del servidor físico.

| Comando | Descripción |
| :--- | :--- |
| `pm2 save` | Guarda la lista actual de procesos activos en un archivo de configuración (`~/.pm2/dump.pm2`). |
| `pm2 resurrect` | Restaura todos los procesos que fueron guardados previamente con `pm2 save`. |
| `pm2 startup [os]` | Genera y configura el script de inicio para tu sistema operativo para que PM2 se inicie al arrancar el equipo. |
| `pm2 unstartup` | Deshabilita e instala el script de inicio automático de PM2. |
| `pm2 cleardump` | Elimina el archivo dump guardado con `pm2 save`. |

> [!TIP]
> **Flujo de Trabajo para Autoinicio:**
> 1. Inicia tus procesos y dales nombre: `pm2 start server.js --name "mi-app"`
> 2. Guarda el estado: `pm2 save`
> 3. Genera la configuración de arranque: `pm2 startup` (y sigue las instrucciones en consola).

---

## 4. Escalado y Modo Cluster

PM2 permite ejecutar múltiples instancias de tu aplicación para aprovechar todos los núcleos de la CPU sin necesidad de modificar tu código.

| Comando | Descripción | Ejemplo |
| :--- | :--- | :--- |
| `pm2 start app.js -i <instancias>` | Inicia la app en modo balanceador de carga (Cluster). `-i max` usa todos los núcleos. | `pm2 start server.js -i max` |
| `pm2 scale <app-name> <instancias>` | Aumenta o disminuye dinámicamente el número de instancias activas. | `pm2 scale clima 4` |

---

## 5. Archivos de Configuración (Ecosystem)

En lugar de usar comandos largos con múltiples banderas, puedes definir la configuración en un archivo JS o JSON (`ecosystem.config.js`).

### Crear archivo de plantilla:
```bash
pm2 ecosystem
```

### Ejemplo de `ecosystem.config.js`:
```javascript
module.exports = {
  apps : [{
    name: 'control-cortex-backend',
    script: './backend/server.js',
    watch: true,
    env: {
      NODE_ENV: 'development',
      PORT: 4000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 80
    }
  }, {
    name: 'modulo-clima',
    script: './server.js',
    cwd: '../modulo de tiempo y clima',
    watch: false
  }]
};
```

### Ejecutar usando el Ecosystem:
* Iniciar todo: `pm2 start ecosystem.config.js`
* Detener todo: `pm2 stop ecosystem.config.js`
* Reiniciar todo: `pm2 restart ecosystem.config.js`

---

## 6. Comandos del Sistema y Mantenimiento

| Comando | Descripción |
| :--- | :--- |
| `pm2 update` | Guarda los procesos, descarga la última versión de PM2 instalada por npm, y los restaura. |
| `pm2 kill` | Detiene por completo el demonio (daemon) de PM2 y todos sus procesos administrados. |
| `pm2 ping` | Comprueba si el daemon de PM2 se está ejecutando en segundo plano. |
| `pm2 serve <path> <port>` | Sirve archivos estáticos (HTML/JS/CSS) en un puerto específico de manera rápida. |

---

> [!NOTE]
> En este entorno Windows donde PM2 se ejecuta a través de Node/npx, puedes anteponer `npx` a los comandos si la terminal no reconoce `pm2` globalmente:
> `npx pm2 list` o `npx pm2 status`
