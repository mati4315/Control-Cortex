# Importaciones de Rulo

Esta carpeta conserva copias de referencia de la configuración anterior para facilitar comparación y una futura migración reversible. Los archivos de esta carpeta son snapshots; no se editan desde el dashboard ni son leídos por el generador del chat público.

| Archivo | Origen | Contenido | Uso actual |
| --- | --- | --- | --- |
| `legacy-style-instruction.json` | `Rulo/Spotify/spotify-vocabulary.json` → `ai.instructions` | Instrucción de estilo anterior, preservada literalmente | Solo referencia. La vista previa activa usa `profile.json`. |
| `spotify-response-catalog.json` | `Rulo/Spotify/spotify-vocabulary.json` → `responses` | Ajustes de selección, 22 contextos, etiquetas y variantes locales/IA | Solo referencia. Chat Bot Spotify sigue siendo dueño del catálogo activo. |
| `context-policy.json` | simulador de Rulo y respuestas casuales de Cortex | Límites de contexto y reglas de retención/aislamiento | Documento de migración; no contiene comentarios ni identidades. |

No se copiaron credenciales, OAuth, comentarios, nombres ni identificadores de participantes. `Rulo/Spotify/spotify-vocabulary.json` permanece intacto como fuente del funcionamiento actual. Antes de convertir cualquier snapshot en dato editable, hay que revisar sus placeholders, sus contextos y la compatibilidad con el contrato existente.
