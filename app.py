import json
import sqlite3
import time
import numpy as np
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)
DB_PATH = "simtele_risk.db"

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        with open("schema.sql", "r", encoding="utf-8") as f:
            conn.executescript(f.read())
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM caso_estudio")
        if cur.fetchone()[0] == 0:
            casos = [
                ("Módulo 1: Detención de emergencia de cabinas", "v1.0-EDO-RK"),
                ("Módulo 2: Deterioro mecánico y mantenimiento", "v1.0-SPD-Raices"),
                ("Módulo 3: Oscilaciones por viento", "v1.0-EDO-Int"),
                ("Módulo 4: Reconstrucción de señales de sensores", "v1.0-Interp")
            ]
            cur.executemany("INSERT INTO caso_estudio (nombre, modelo_version) VALUES (?, ?)", casos)
            conn.commit()

# --- TEORÍA DE ERRORES TRANSVERSAL ---
def calcular_errores(x_aprox, x_ref, A, b):
    err_abs = float(np.linalg.norm(x_aprox - x_ref, np.inf))
    norm_ref = max(float(np.linalg.norm(x_ref, np.inf)), 1e-14)
    err_rel = err_abs / norm_ref
    err_pct = err_rel * 100.0
    residual = float(np.linalg.norm(A @ x_aprox - b, np.inf))
    return err_abs, err_rel, err_pct, residual

# --- MÉTODOS DE SISTEMAS LINEALES (SEMANA 1) ---
def solve_jacobi(A, b, x_ref, tol=1e-6, max_iter=500):
    t0 = time.perf_counter()
    n = len(b)
    x = np.zeros(n)
    historial = []
    convergio = False
    for k in range(1, max_iter + 1):
        x_new = np.zeros(n)
        for i in range(n):
            s = sum(A[i, j] * x[j] for j in range(n) if j != i)
            x_new[i] = (b[i] - s) / A[i, i]
        err_abs, err_rel, _, res = calcular_errores(x_new, x_ref, A, b)
        historial.append({
            "iter": k,
            "x": [round(float(v), 6) for v in x_new],
            "residual": res,
            "error_abs": err_abs,
            "error_rel": err_rel
        })
        if np.linalg.norm(x_new - x, np.inf) < tol:
            convergio = True
            x = x_new
            break
        x = x_new
        if err_abs > 1e100:
            break
    t_ms = (time.perf_counter() - t0) * 1000.0
    return x, historial, convergio, t_ms

def solve_gauss_seidel(A, b, x_ref, tol=1e-6, max_iter=500):
    t0 = time.perf_counter()
    n = len(b)
    x = np.zeros(n)
    historial = []
    convergio = False
    for k in range(1, max_iter + 1):
        x_old = x.copy()
        for i in range(n):
            s1 = sum(A[i, j] * x[j] for j in range(i))
            s2 = sum(A[i, j] * x_old[j] for j in range(i + 1, n))
            x[i] = (b[i] - s1 - s2) / A[i, i]
        err_abs, err_rel, _, res = calcular_errores(x, x_ref, A, b)
        historial.append({
            "iter": k,
            "x": [round(float(v), 6) for v in x],
            "residual": res,
            "error_abs": err_abs,
            "error_rel": err_rel
        })
        if np.linalg.norm(x - x_old, np.inf) < tol:
            convergio = True
            break
    t_ms = (time.perf_counter() - t0) * 1000.0
    return x, historial, convergio, t_ms

def solve_conjugate_gradient(A, b, x_ref, tol=1e-6, max_iter=500):
    t0 = time.perf_counter()
    x = np.zeros(len(b))
    r = b - A @ x
    p = r.copy()
    rs_old = float(np.dot(r, r))
    historial = []
    convergio = False
    for k in range(1, max_iter + 1):
        Ap = A @ p
        alpha = rs_old / float(np.dot(p, Ap))
        x = x + alpha * p
        r = r - alpha * Ap
        rs_new = float(np.dot(r, r))
        err_abs, err_rel, _, res = calcular_errores(x, x_ref, A, b)
        historial.append({
            "iter": k,
            "x": [round(float(v), 6) for v in x],
            "residual": res,
            "error_abs": err_abs,
            "error_rel": err_rel
        })
        if np.sqrt(rs_new) < tol:
            convergio = True
            break
        p = r + (rs_new / rs_old) * p
        rs_old = rs_new
    t_ms = (time.perf_counter() - t0) * 1000.0
    return x, historial, convergio, t_ms

def solve_lu(A, b, x_ref):
    t0 = time.perf_counter()
    n = len(b)
    L = np.eye(n)
    U = A.copy().astype(float)
    for i in range(n):
        for j in range(i + 1, n):
            factor = U[j, i] / U[i, i]
            L[j, i] = factor
            U[j, i:] -= factor * U[i, i:]
    y = np.zeros(n)
    for i in range(n):
        y[i] = b[i] - np.dot(L[i, :i], y[:i])
    x = np.zeros(n)
    for i in range(n - 1, -1, -1):
        x[i] = (y[i] - np.dot(U[i, i + 1:], x[i + 1:])) / U[i, i]
    t_ms = (time.perf_counter() - t0) * 1000.0
    err_abs, err_rel, _, res = calcular_errores(x, x_ref, A, b)
    historial = [{
        "iter": 1,
        "x": [round(float(v), 6) for v in x],
        "residual": res,
        "error_abs": err_abs,
        "error_rel": err_rel
    }]
    return x, historial, True, t_ms

def get_scenario_data(tipo):
    A_base = np.array([
        [10.0, -1.0,  2.0,  0.0],
        [-1.0, 11.0, -1.0,  3.0],
        [ 2.0, -1.0, 10.0, -1.0],
        [ 0.0,  3.0, -1.0,  8.0]
    ])
    x_exact_base = np.array([1.0, 2.0, -1.0, 1.0])
    b_base = A_base @ x_exact_base

    if tipo == "NORMAL":
        return A_base, b_base, x_exact_base, 1e-6, 500
    elif tipo == "ESTRES":
        delta_b = np.array([0.05, -0.05, 0.05, -0.05])
        b_est = b_base + delta_b
        x_ref = np.linalg.solve(A_base, b_est)
        return A_base, b_est, x_ref, 1e-10, 500
    else:  # MAL_CONDICIONADO
        H4 = np.array([[1.0 / (i + j + 1) for j in range(4)] for i in range(4)])
        A_ill = H4 + 1e-4 * np.eye(4)
        b_ill = A_ill @ x_exact_base
        return A_ill, b_ill, x_exact_base, 1e-6, 500

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/ejecutar", methods=["POST"])
def ejecutar():
    data = request.json or {}
    tipo = data.get("escenario", "NORMAL")
    A, b, x_ref, tol, max_iter = get_scenario_data(tipo)
    cond_A = float(np.linalg.cond(A))

    metodos_res = {}
    for nombre, fn in [
        ("Jacobi", lambda: solve_jacobi(A, b, x_ref, tol, max_iter)),
        ("Gauss-Seidel", lambda: solve_gauss_seidel(A, b, x_ref, tol, max_iter)),
        ("Gradiente Conjugado", lambda: solve_conjugate_gradient(A, b, x_ref, tol, max_iter)),
        ("Factorización LU", lambda: solve_lu(A, b, x_ref))
    ]:
        x_sol, hist, conv, t_ms = fn()
        e_abs, e_rel, e_pct, res = calcular_errores(x_sol, x_ref, A, b)
        metodos_res[nombre] = {
            "solucion": [round(float(v), 6) for v in x_sol],
            "iteraciones_totales": len(hist),
            "convergio": conv,
            "tiempo_ms": round(t_ms, 4),
            "error_abs": e_abs,
            "error_rel": e_rel,
            "error_pct": e_pct,
            "residual": res,
            "historial": hist[:15]
        }

    # Guardar en SQLite cumpliendo las 6 entidades del modelo de datos
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.cursor()
        params_json = json.dumps({"condicion_A": round(cond_A, 4), "tolerancia": tol, "b": b.tolist()})
        cur.execute(
            "INSERT INTO escenario (caso_id, tipo, parametros_json, fuente_datos) VALUES (?, ?, ?, ?)",
            (2, tipo, params_json, "Datos Sintéticos SPD 4x4 - SIMTELE-RISK")
        )
        escenario_id = cur.lastrowid
        cur.execute(
            "INSERT INTO simulacion (escenario_id, usuario_equipo, estado) VALUES (?, ?, ?)",
            (escenario_id, "Grupo Paralelo A - UMSA", "COMPLETADO")
        )
        simulacion_id = cur.lastrowid

        for m_nombre, m_info in metodos_res.items():
            cur.execute(
                """INSERT INTO ejecucion_metodo 
                   (simulacion_id, metodo, tolerancia, paso, max_iter, convergio, tiempo_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (simulacion_id, m_nombre, tol, 0.0, max_iter, 1 if m_info["convergio"] else 0, m_info["tiempo_ms"])
            )
            ejec_id = cur.lastrowid
            for h in m_info["historial"]:
                cur.execute(
                    """INSERT INTO iteracion_resultado
                       (ejecucion_id, numero, aproximacion_json, residual, error_abs, error_rel)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (ejec_id, h["iter"], json.dumps(h["x"]), h["residual"], h["error_abs"], h["error_rel"])
                )
            cur.execute(
                """INSERT INTO resultado_resumen
                   (ejecucion_id, referencia, valor_json, metrica_error_json, interpretacion)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    ejec_id,
                    json.dumps([round(float(v), 6) for v in x_ref]),
                    json.dumps(m_info["solucion"]),
                    json.dumps({"error_abs": m_info["error_abs"], "error_pct": m_info["error_pct"], "residual": m_info["residual"]}),
                    f"Escenario {tipo} con k(A)={cond_A:.2f}"
                )
            )
        conn.commit()

    return jsonify({
        "simulacion_id": simulacion_id,
        "escenario": tipo,
        "condicion": round(cond_A, 4),
        "tolerancia": tol,
        "referencia": [round(float(v), 6) for v in x_ref],
        "matriz_A": A.round(5).tolist(),
        "vector_b": b.round(5).tolist(),
        "metodos": metodos_res
    })

@app.route("/api/historial", methods=["GET"])
def obtener_historial():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("""
            SELECT s.id AS sim_id, s.fecha, s.usuario_equipo, e.tipo, e.parametros_json,
                   COUNT(em.id) AS num_metodos
            FROM simulacion s
            JOIN escenario e ON s.escenario_id = e.id
            LEFT JOIN ejecucion_metodo em ON em.simulacion_id = s.id
            GROUP BY s.id
            ORDER BY s.id DESC LIMIT 10
        """)
        filas = [dict(r) for r in cur.fetchall()]
    return jsonify(filas)

if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)