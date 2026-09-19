// Version del modulo que la extension carga desde local-overrides.
// Al tocar spotify-auto-music.js hay que subir este numero: el auto-patcher
// reescribe la linea del loader con esta version (asi el navegador no usa la
// copia vieja) y el dashboard muestra la version reportada por la extension.
'use strict';

module.exports = {
  SPOTIFY_MODULE_VERSION: 31
};
