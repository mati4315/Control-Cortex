import io
def sub(path, pairs):
    s=io.open(path,encoding='utf-8').read()
    for a,b in pairs:
        assert a in s, (path, a[:70])
        s=s.replace(a,b)
    io.open(path,'w',encoding='utf-8',newline='\n').write(s)
    print('ok', path)

sub('Rulo/Spotify/README.md', [
 ("""| `spotify-settings.json` | Fuente única de verdad de los ajustes (lo escribe el backend) |""",
  """| `spotify-settings.json` | Fuente única de verdad de los ajustes (lo escribe el backend) |
| `spotify-aliases.json` | Correcciones de escritura aprendidas (`laberiso` → `la beriso`) |"""),
 ("""GET  /api/spotify-device-target     compatibilidad (panel viejo de Cortex)""",
  """GET  /api/spotify-aliases           correcciones de escritura guardadas
POST /api/spotify-aliases           guarda una correccion {from, to}
POST /api/spotify-aliases-delete    quita una {from}
POST /api/spotify-aliases-clear     vacia todas
GET  /api/spotify-device-target     compatibilidad (panel viejo de Cortex)"""),
])

sub('Control Cortex/integrations/spotify-auto-music/README.md', [
 ("""## Dashboard (Rulo/Spotify)""",
  """## Tolerancia a errores de escritura

El parser acepta saludos, muletillas, "temita/temazo" como sinonimo de "tema" y pedidos sin la palabra
tema ("pasame a ke personajes"). Si la busqueda no encuentra nada, prueba variantes (articulo pegado
"laberiso" -> "la beriso", sin articulo, y confusiones i/y, b/v, s/z, ll/y, qu/k, c/s; hasta 7 intentos)
y guarda la correccion que funciono en `Rulo/Spotify/spotify-aliases.json` para la proxima. Las
correcciones se ven y se cargan a mano desde el dashboard.

## Dashboard (Rulo/Spotify)"""),
 ("""| Pruebas | Reproducir un tema ya, simular un comentario real, pausa/siguiente/anterior |""",
  """| Pruebas | Reproducir un tema ya, simular un comentario real, pausa/siguiente/anterior |"""),
])
