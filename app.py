import os
import json
import socket
import sqlite3
from contextlib import closing
from flask import Flask, render_template, request, jsonify

import motor_numerico as mn

# ===========================================================================
# --- CONFIGURACIÓN DE FLASK Y BASE DE DATOS (DER de 6 Tablas) --------------
# ===========================================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, template_folder=os.path.join(BASE_DIR, "templates"))
DB_PATH = os.environ.get("SIMTELE_DB", os.path.join(BASE_DIR, "simtele_risk.db"))

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS caso_estudio (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, modelo_version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS escenario (
    id INTEGER PRIMARY KEY AUTOINCREMENT, caso_id INTEGER NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('NORMAL', 'ESTRES', 'MAL_CONDICIONADO')),
    parametros_json TEXT NOT NULL, fuente_datos TEXT NOT NULL,
    FOREIGN KEY (caso_id) REFERENCES caso_estudio(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS simulacion (
    id INTEGER PRIMARY KEY AUTOINCREMENT, escenario_id INTEGER NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP, usuario_equipo TEXT, estado TEXT NOT NULL,
    snapshot_json TEXT,
    FOREIGN KEY (escenario_id) REFERENCES escenario(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ejecucion_metodo (
    id INTEGER PRIMARY KEY AUTOINCREMENT, simulacion_id INTEGER NOT NULL,
    metodo TEXT NOT NULL, tolerancia REAL, paso REAL, max_iter INTEGER,
    convergio INTEGER NOT NULL, tiempo_ms REAL NOT NULL,
    FOREIGN KEY (simulacion_id) REFERENCES simulacion(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS iteracion_resultado (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ejecucion_id INTEGER NOT NULL,
    numero INTEGER NOT NULL, aproximacion_json TEXT NOT NULL,
    residual REAL, error_abs REAL, error_rel REAL,
    FOREIGN KEY (ejecucion_id) REFERENCES ejecucion_metodo(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS resultado_resumen (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ejecucion_id INTEGER NOT NULL UNIQUE,
    referencia TEXT NOT NULL, valor_json TEXT NULL,
    metrica_error_json TEXT NOT NULL, interpretacion TEXT NOT NULL,
    FOREIGN KEY (ejecucion_id) REFERENCES ejecucion_metodo(id) ON DELETE CASCADE
);
"""

_SCHEMA_EXEC = SCHEMA_SQL.replace("valor_json TEXT NULL", "valor_json TEXT NOT NULL")
_INITIALIZED_DBS: set[str] = set()


def _get_db_path() -> str:
    return os.environ.get("SIMTELE_DB", DB_PATH)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Inicializa y migra la base de datos SQLite de 6 tablas."""
    db_path = _get_db_path()
    with closing(_connect()) as conn:
        conn.executescript(_SCHEMA_EXEC)
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(simulacion)").fetchall()]
        if "snapshot_json" not in cols:
            conn.execute("ALTER TABLE simulacion ADD COLUMN snapshot_json TEXT")
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS cnt FROM caso_estudio")
        if cur.fetchone()["cnt"] == 0:
            casos = [
                ("Módulo 1: Detención de emergencia de cabinas", "v3.0-EDO-Int-Raices"),
                ("Módulo 2: Deterioro mecánico y mantenimiento", "v3.0-SPD-Raices"),
                ("Módulo 3: Oscilaciones por viento", "v3.0-EDO-Int"),
                ("Módulo 4: Reconstrucción de señales de sensores", "v3.0-Interp-Raices"),
            ]
            cur.executemany("INSERT INTO caso_estudio (nombre, modelo_version) VALUES (?, ?)", casos)
        conn.commit()
    _INITIALIZED_DBS.add(db_path)


def _asegurar_db():
    db_path = _get_db_path()
    if db_path not in _INITIALIZED_DBS or not os.path.exists(db_path):
        init_db()


def _safe_json_loads(raw: str | None, fallback=None):
    if raw is None:
        return fallback
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return raw


def _guardar_simulacion_bd(caso_id: int, tipo: str, resultado: dict) -> int:
    _asegurar_db()
    with closing(_connect()) as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO escenario (caso_id, tipo, parametros_json, fuente_datos) VALUES (?, ?, ?, ?)",
            (
                caso_id,
                tipo,
                json.dumps(resultado["params"], ensure_ascii=False),
                "Sintético SIMTELE-RISK v3 (parámetros supuestos)",
            ),
        )
        esc_id = cur.lastrowid

        cur.execute(
            "INSERT INTO simulacion (escenario_id, usuario_equipo, estado, snapshot_json) VALUES (?, ?, ?, ?)",
            (
                esc_id,
                "Equipo SIMTELE-RISK",
                "COMPLETADO",
                json.dumps(resultado, ensure_ascii=False),
            ),
        )
        sim_id = cur.lastrowid

        for m in resultado["metodos"]:
            cur.execute(
                """INSERT INTO ejecucion_metodo
                   (simulacion_id, metodo, tolerancia, paso, max_iter, convergio, tiempo_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    sim_id,
                    m["nombre"],
                    m.get("tolerancia"),
                    m.get("paso"),
                    m.get("max_iter"),
                    1 if m.get("convergio") else 0,
                    float(m.get("tiempo_ms", 0.0)),
                ),
            )
            ejec_id = cur.lastrowid

            iters = m.get("iteraciones") or []
            if iters:
                cur.executemany(
                    """INSERT INTO iteracion_resultado
                       (ejecucion_id, numero, aproximacion_json, residual, error_abs, error_rel)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    [
                        (
                            ejec_id,
                            int(it["n"]),
                            json.dumps(it, ensure_ascii=False),
                            it.get("residual"),
                            it.get("error_abs"),
                            it.get("error_rel"),
                        )
                        for it in iters
                    ],
                )

            metricas = {
                "abs": m.get("error_abs"),
                "rel": m.get("error_rel"),
                "pct": m.get("error_pct"),
                "residual": m.get("residual"),
                "criterio": m.get("criterio_parada"),
            }
            cur.execute(
                """INSERT INTO resultado_resumen
                   (ejecucion_id, referencia, valor_json, metrica_error_json, interpretacion)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    ejec_id,
                    json.dumps(m.get("referencia"), ensure_ascii=False),
                    json.dumps(m.get("resultado"), ensure_ascii=False),
                    json.dumps(metricas, ensure_ascii=False),
                    m.get("interpretacion", ""),
                ),
            )

        conn.commit()
    return sim_id


# ===========================================================================
# --- RUTAS FLASK (Web y API v3) --------------------------------------------
# ===========================================================================

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/estado", methods=["GET"])
def estado():
    _asegurar_db()
    return jsonify({"motor": "python", "bd": "sqlite", "version": "v3"})


@app.route("/api/ejecutar/<int:modulo>", methods=["POST"])
def ejecutar_modulo(modulo: int):
    if modulo not in mn.PRESETS:
        return jsonify({"errores": ["Módulo inválido (debe ser 1, 2, 3 o 4)."]}), 400

    body = request.get_json(silent=True) or {}
    escenario = body.get("escenario", "NORMAL")
    if escenario not in mn.PRESETS[modulo]:
        return jsonify({"errores": ["Escenario inválido (NORMAL, ESTRES o MAL_CONDICIONADO)."]}), 400

    params_user = body.get("params")
    if params_user is not None and not isinstance(params_user, dict):
        return jsonify({"errores": ["El campo 'params' debe ser un objeto JSON."]}), 400

    guardar = bool(body.get("guardar", True))

    params_merged = mn._coercer_params(modulo, escenario, params_user)
    errores = mn.validar(modulo, params_merged)
    if errores:
        return jsonify({"errores": errores}), 400

    try:
        resultado = mn.ejecutar(modulo, escenario, params_merged)
    except ValueError as exc:
        return jsonify({"errores": [str(exc)]}), 400

    if guardar:
        sim_id = _guardar_simulacion_bd(modulo, escenario, resultado)
        resultado["sim_id"] = sim_id

    return jsonify(resultado)


def _consultar_simulaciones():
    _asegurar_db()
    modulo = request.args.get("modulo", "").strip()
    escenario = request.args.get("escenario", "").strip()
    q = request.args.get("q", "").strip()

    where = []
    args: list = []
    if modulo:
        where.append("e.caso_id = ?")
        args.append(modulo)
    if escenario:
        where.append("e.tipo = ?")
        args.append(escenario)
    if q:
        like_q = f"%{q}%"
        where.append("(CAST(s.id AS TEXT) LIKE ? OR s.fecha LIKE ? OR c.nombre LIKE ?)")
        args.extend([like_q, like_q, like_q])

    sql = """
        SELECT s.id AS sim_id, s.fecha, e.caso_id AS modulo, c.nombre AS caso,
               e.tipo, s.estado, (s.snapshot_json IS NOT NULL) AS tiene_snapshot
        FROM simulacion s
        JOIN escenario e ON s.escenario_id = e.id
        JOIN caso_estudio c ON e.caso_id = c.id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY s.id DESC LIMIT 100"

    with closing(_connect()) as conn:
        rows = conn.execute(sql, args).fetchall()
        return [
            {
                "sim_id": r["sim_id"],
                "fecha": r["fecha"],
                "modulo": r["modulo"],
                "caso": r["caso"],
                "tipo": r["tipo"],
                "estado": r["estado"],
                "tiene_snapshot": bool(r["tiene_snapshot"]),
            }
            for r in rows
        ]


@app.route("/api/simulaciones", methods=["GET"])
@app.route("/api/historial", methods=["GET"])
def listar_simulaciones():
    return jsonify(_consultar_simulaciones())


@app.route("/api/simulaciones/<int:sim_id>", methods=["GET"])
def detalle_simulacion(sim_id: int):
    _asegurar_db()
    with closing(_connect()) as conn:
        row = conn.execute(
            """
            SELECT s.id AS sim_id, s.fecha, s.estado, s.snapshot_json,
                   e.caso_id AS modulo, e.tipo AS escenario, e.parametros_json,
                   c.nombre AS caso
            FROM simulacion s
            JOIN escenario e ON s.escenario_id = e.id
            JOIN caso_estudio c ON e.caso_id = c.id
            WHERE s.id = ?
            """,
            (sim_id,),
        ).fetchone()
        if row is None:
            return jsonify({"error": "Simulación no encontrada."}), 404

        ejecs_rows = conn.execute(
            "SELECT * FROM ejecucion_metodo WHERE simulacion_id = ? ORDER BY id ASC",
            (sim_id,),
        ).fetchall()

        ejecuciones = []
        for em in ejecs_rows:
            it_rows = conn.execute(
                "SELECT * FROM iteracion_resultado WHERE ejecucion_id = ? ORDER BY id ASC",
                (em["id"],),
            ).fetchall()
            res_row = conn.execute(
                "SELECT * FROM resultado_resumen WHERE ejecucion_id = ?",
                (em["id"],),
            ).fetchone()

            iteraciones = []
            for ir in it_rows:
                parsed_it = _safe_json_loads(ir["aproximacion_json"], {})
                if isinstance(parsed_it, dict):
                    iteraciones.append(parsed_it)
                else:
                    iteraciones.append({
                        "n": ir["numero"],
                        "aprox": parsed_it,
                        "residual": ir["residual"],
                        "error_abs": ir["error_abs"],
                        "error_rel": ir["error_rel"],
                    })

            resumen = None
            if res_row is not None:
                resumen = {
                    "referencia": _safe_json_loads(res_row["referencia"]),
                    "valor": _safe_json_loads(res_row["valor_json"]),
                    "metricas": _safe_json_loads(res_row["metrica_error_json"], {}),
                    "interpretacion": res_row["interpretacion"],
                }

            ejecuciones.append({
                "metodo": em["metodo"],
                "tolerancia": em["tolerancia"],
                "paso": em["paso"],
                "max_iter": em["max_iter"],
                "convergio": bool(em["convergio"]),
                "tiempo_ms": em["tiempo_ms"],
                "iteraciones": iteraciones,
                "resumen": resumen,
            })

        return jsonify({
            "sim_id": row["sim_id"],
            "fecha": row["fecha"],
            "modulo": row["modulo"],
            "caso": row["caso"],
            "escenario": row["escenario"],
            "params": _safe_json_loads(row["parametros_json"], {}),
            "snapshot": _safe_json_loads(row["snapshot_json"], None),
            "ejecuciones": ejecuciones,
        })


def _obtener_puerto_disponible(puerto_preferido=5000, intentos=20):
    """Devuelve el primer puerto libre en 127.0.0.1 a partir de puerto_preferido."""
    for puerto in range(puerto_preferido, puerto_preferido + intentos):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", puerto))
                return puerto
            except OSError:
                continue
    raise OSError(f"No se encontró un puerto disponible entre {puerto_preferido} y {puerto_preferido + intentos - 1}.")


if __name__ == "__main__":
    init_db()
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        puerto = int(os.environ.get("SIMTELE_PORT", os.environ.get("PORT", "5000")))
    else:
        puerto_preferido = int(os.environ.get("PORT", "5000"))
        puerto = _obtener_puerto_disponible(puerto_preferido)
        os.environ["SIMTELE_PORT"] = str(puerto)
        if puerto != puerto_preferido:
            print(f"[AVISO] El puerto {puerto_preferido} está ocupado/reservado por el sistema. Usando http://127.0.0.1:{puerto}")
    app.run(host="127.0.0.1", port=puerto, debug=True)
