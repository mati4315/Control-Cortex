#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Junta lo importante del historial de pedidos de Rulo para el recordatorio.

Lo usa el cron de Hermes (tarea "Rulo - recordatorio de analisis") cada semana:
imprime un resumen en texto y ademas el JSON crudo, que el agente usa para
escribir el recordatorio en el chat.

Se puede correr a mano:
    python "Control Cortex/tools/recordatorio-analisis.py"          (7 dias)
    python "Control Cortex/tools/recordatorio-analisis.py" 30       (30 dias)
"""

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:4000"
DIAS = sys.argv[1] if len(sys.argv) > 1 else "7"


def traer(ruta):
    try:
        with urllib.request.urlopen(BASE + ruta, timeout=10) as respuesta:
            return json.loads(respuesta.read().decode("utf-8"))
    except urllib.error.URLError as error:
        return {"error": "no se pudo consultar %s (%s)" % (ruta, error)}
    except Exception as error:  # noqa: BLE001 - el cron no debe explotar
        return {"error": "%s: %s" % (ruta, error)}


def main():
    datos = traer("/api/spotify-analytics?dias=" + DIAS)
    if datos.get("error"):
        print("El backend de Control Cortex no respondio: " + datos["error"])
        print("Si el stream no estaba al aire, es normal: no hay nada nuevo para revisar.")
        return
    a = datos.get("analytics") or {}
    print("RESUMEN DE LOS ULTIMOS %s DIAS (Rulo / Spotify)" % a.get("dias", DIAS))
    print("Base de datos: %s" % a.get("filePath", "?"))
    print("")
    print("Pedidos de musica: %s" % a.get("pedidos", 0))
    print("Reproducidas: %s | No encontradas: %s | Rechazadas por espera: %s" % (
        a.get("reproducidas", 0), a.get("noEncontradas", 0), a.get("rechazadas", 0)))
    print("Interacciones totales: %s" % a.get("total", 0))
    print("Con IA: interpreto %s pedidos, respondio %s veces" % (
        a.get("conIaInterpretando", 0), a.get("conIaRespondiendo", 0)))
    print("")

    recordatorio = a.get("recordatorio") or {}
    if recordatorio.get("pendientes"):
        print("SIN REVISAR: %s interacciones (%s sin encontrar), la mas vieja espera hace %s dia(s)." % (
            recordatorio.get("pendientes"), recordatorio.get("nuevosNoEncontrados"), recordatorio.get("diasEsperando")))
        print("")

    avisos = a.get("avisos") or []
    if avisos:
        print("AVISOS:")
        for aviso in avisos:
            print("- [%s] %s" % (aviso.get("nivel"), aviso.get("mensaje")))
        print("")

    no_encontradas = a.get("noEncontradasDetalle") or []
    if no_encontradas:
        print("LO QUE PIDIERON Y NO SE ENCONTRO (para entrenar):")
        for fila in no_encontradas[:10]:
            print("- \"%s\"" % (fila.get("comment") or fila.get("query") or ""))
        print("")

    canciones = a.get("topCanciones") or []
    if canciones:
        print("CANCIONES MAS PEDIDAS:")
        for fila in canciones[:8]:
            extra = []
            if fila.get("continuaciones"):
                extra.append("%s de Rulo solo" % fila["continuaciones"])
            if fila.get("saltadas"):
                extra.append("%s saltadas" % fila["saltadas"])
            print("- %s - %s (%s puestas%s)" % (
                fila.get("track_name"), fila.get("track_artist") or "?", fila.get("puestas", 0),
                (", " + ", ".join(extra)) if extra else ""))
        print("")

    repetidos = a.get("topPedidosRepetidos") or []
    if repetidos:
        print("PEDIDOS REPETIDOS:")
        for fila in repetidos[:6]:
            print("- \"%s\" x%s" % (fila.get("comment"), fila.get("n")))
        print("")

    tasa = a.get("tasaSalteo") or {}
    if tasa.get("puestas"):
        print("ENGANCHE: de %s temas puestos se saltaron o pausaron %s (%s%%)." % (
            tasa.get("puestas"), tasa.get("saltadas"), tasa.get("porcentaje")))
        print("")

    if a.get("avisos"):
        print("Recordatorio: para aplicar correcciones, abri el panel (seccion Analisis) y usa el boton de sugerencias con IA.")
    print("")
    print("DATOS CRUDOS (JSON):")
    print(json.dumps(a, ensure_ascii=False)[:6000])


if __name__ == "__main__":
    main()
