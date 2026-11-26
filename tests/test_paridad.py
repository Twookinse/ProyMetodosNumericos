"""Prueba de paridad 1:1 entre motor_numerico.py y static/js/motor.js."""

import json
import os
import subprocess
import sys
import tempfile

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import motor_numerico as mn


def main():
    casos = []
    for mod in (1, 2, 3, 4):
        for esc in ("NORMAL", "ESTRES", "MAL_CONDICIONADO"):
            casos.append({
                "modulo": mod,
                "escenario": esc,
                "params": None,
                "etiqueta": "",
                "resultado": mn.ejecutar(mod, esc),
            })

    # Caso extra obligatorio: M4 MAL con distribución chebyshev
    casos.append({
        "modulo": 4,
        "escenario": "MAL_CONDICIONADO",
        "params": {"distribucion": "chebyshev"},
        "etiqueta": "(chebyshev)",
        "resultado": mn.ejecutar(4, "MAL_CONDICIONADO", {"distribucion": "chebyshev"}),
    })

    payload = {
        "presets": {str(k): v for k, v in mn.PRESETS.items()},
        "casos": casos,
    }

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
        json.dump(payload, tmp)
        tmp_path = tmp.name

    try:
        js_script = os.path.join(BASE_DIR, "tests", "paridad_motor.js")
        proc = subprocess.run(["node", js_script, tmp_path], capture_output=True, text=True, check=False)
        if proc.stdout:
            print(proc.stdout.strip())
        if proc.stderr:
            print(proc.stderr.strip(), file=sys.stderr)
        if proc.returncode != 0:
            raise SystemExit(proc.returncode)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


if __name__ == "__main__":
    main()
