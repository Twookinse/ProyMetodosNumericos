import os
import json
import sqlite3
import time
import numpy as np
from flask import Flask, render_template, request, jsonify

# ===========================================================================
# --- CONFIGURACIÓN DE FLASK Y BASE DE DATOS (DER de 6 Tablas) --------------
# ===========================================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, template_folder=os.path.join(BASE_DIR, "templates"))
DB_PATH = os.path.join(BASE_DIR, "simtele_risk.db")

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
    referencia TEXT NOT NULL, valor_json TEXT NOT NULL,
    metrica_error_json TEXT NOT NULL, interpretacion TEXT NOT NULL,
    FOREIGN KEY (ejecucion_id) REFERENCES ejecucion_metodo(id) ON DELETE CASCADE
);
"""

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(SCHEMA_SQL)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM caso_estudio")
        if cur.fetchone()[0] == 0:
            casos = [
                ("Módulo 1: Detención de emergencia de cabinas", "v2.0-EDO-Int-Raices"),
                ("Módulo 2: Deterioro mecánico y mantenimiento", "v2.0-SPD-Raices"),
                ("Módulo 3: Oscilaciones por viento", "v2.0-EDO-Int"),
                ("Módulo 4: Reconstrucción de señales de sensores", "v2.0-Interp")
            ]
            cur.executemany("INSERT INTO caso_estudio (nombre, modelo_version) VALUES (?, ?)", casos)
            conn.commit()

# ===========================================================================
# --- TEORÍA DE ERRORES TRANSVERSAL -----------------------------------------
# ===========================================================================

def calcular_errores(x_aprox, x_ref, A=None, b=None):
    x_aprox = np.atleast_1d(x_aprox)
    x_ref = np.atleast_1d(x_ref)
    err_abs = float(np.linalg.norm(x_aprox - x_ref, np.inf))
    norm_ref = max(float(np.linalg.norm(x_ref, np.inf)), 1e-14)
    err_rel = err_abs / norm_ref
    res = 0.0
    if A is not None and b is not None:
        res = float(np.linalg.norm(A @ x_aprox - b, np.inf))
    return err_abs, err_rel, err_rel * 100.0, res

# ===========================================================================
# --- ALGORITMOS: SISTEMAS LINEALES (Semana 1) ------------------------------
# ===========================================================================

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
        e_abs, e_rel, _, res = calcular_errores(x_new, x_ref, A, b)
        historial.append({"iter": k, "x": [round(float(v), 6) for v in x_new], "residual": res, "error_abs": e_abs})
        if np.linalg.norm(x_new - x, np.inf) < tol:
            convergio = True; x = x_new; break
        x = x_new
        if e_abs > 1e100: break
    return x, historial, convergio, (time.perf_counter() - t0) * 1000.0

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
        e_abs, e_rel, _, res = calcular_errores(x, x_ref, A, b)
        historial.append({"iter": k, "x": [round(float(v), 6) for v in x], "residual": res, "error_abs": e_abs})
        if np.linalg.norm(x - x_old, np.inf) < tol:
            convergio = True; break
    return x, historial, convergio, (time.perf_counter() - t0) * 1000.0

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
        e_abs, e_rel, _, res = calcular_errores(x, x_ref, A, b)
        historial.append({"iter": k, "x": [round(float(v), 6) for v in x], "residual": res, "error_abs": e_abs})
        if np.sqrt(rs_new) < tol:
            convergio = True; break
        p = r + (rs_new / rs_old) * p
        rs_old = rs_new
    return x, historial, convergio, (time.perf_counter() - t0) * 1000.0

def solve_lu(A, b, x_ref):
    t0 = time.perf_counter()
    n = len(b)
    L = np.eye(n); U = A.copy().astype(float)
    for i in range(n):
        for j in range(i + 1, n):
            factor = U[j, i] / U[i, i]
            L[j, i] = factor
            U[j, i:] -= factor * U[i, i:]
    y = np.zeros(n)
    for i in range(n): y[i] = b[i] - np.dot(L[i, :i], y[:i])
    x = np.zeros(n)
    for i in range(n - 1, -1, -1): x[i] = (y[i] - np.dot(U[i, i + 1:], x[i + 1:])) / U[i, i]
    e_abs, e_rel, _, res = calcular_errores(x, x_ref, A, b)
    historial = [{"iter": 1, "x": [round(float(v), 6) for v in x], "residual": res, "error_abs": e_abs}]
    return x, historial, True, (time.perf_counter() - t0) * 1000.0

# ===========================================================================
# --- ALGORITMOS: RAÍCES DE ECUACIONES (Semana 2) ---------------------------
# ===========================================================================

def biseccion(f, a, b, tol=1e-6, max_iter=100, x_ref=None):
    t0 = time.perf_counter()
    historial = []
    if f(a) * f(b) > 0: return None, [], False, 0.0
    x_mid = a
    for k in range(1, max_iter + 1):
        x_mid = (a + b) / 2.0
        res = abs(f(x_mid))
        e_abs, e_rel, _, _ = calcular_errores(x_mid, x_ref) if x_ref else (0,0,0,0)
        historial.append({"iter": k, "x": round(x_mid, 6), "residual": res, "error_abs": e_abs})
        if res < tol or abs(b - a) / 2.0 < tol: return x_mid, historial, True, (time.perf_counter() - t0)*1000.0
        if f(a) * f(x_mid) < 0: b = x_mid
        else: a = x_mid
    return x_mid, historial, False, (time.perf_counter() - t0)*1000.0

def newton_raphson(f, df, x0, tol=1e-6, max_iter=100, x_ref=None):
    t0 = time.perf_counter()
    historial = []
    x = x0
    for k in range(1, max_iter + 1):
        derivada = df(x)
        if abs(derivada) < 1e-14: break
        x_new = x - f(x) / derivada
        res = abs(f(x_new))
        e_abs, e_rel, _, _ = calcular_errores(x_new, x_ref) if x_ref else (0,0,0,0)
        historial.append({"iter": k, "x": round(x_new, 6), "residual": res, "error_abs": e_abs})
        if abs(x_new - x) < tol or res < tol: return x_new, historial, True, (time.perf_counter() - t0)*1000.0
        x = x_new
    return x, historial, False, (time.perf_counter() - t0)*1000.0

def secante(f, x0, x1, tol=1e-6, max_iter=100, x_ref=None):
    t0 = time.perf_counter()
    historial = []
    for k in range(1, max_iter + 1):
        den = f(x1) - f(x0)
        if abs(den) < 1e-14: break
        x_new = x1 - f(x1) * (x1 - x0) / den
        res = abs(f(x_new))
        e_abs, e_rel, _, _ = calcular_errores(x_new, x_ref) if x_ref else (0,0,0,0)
        historial.append({"iter": k, "x": round(x_new, 6), "residual": res, "error_abs": e_abs})
        if abs(x_new - x1) < tol or res < tol: return x_new, historial, True, (time.perf_counter() - t0)*1000.0
        x0, x1 = x1, x_new
    return x1, historial, False, (time.perf_counter() - t0)*1000.0

# ===========================================================================
# --- ALGORITMOS: EDOs (Semana 2) -------------------------------------------
# ===========================================================================

def rk2_heun(f, t0, y0, h, n_steps, f_ref=None):
    t0_cpu = time.perf_counter()
    historial = []
    t, y = t0, np.array(y0, dtype=float)
    for k in range(n_steps + 1):
        e_abs = float(np.linalg.norm(y - np.array(f_ref(t)))) if f_ref else 0.0
        historial.append({"iter": k, "t": round(t, 4), "y": [round(float(v), 6) for v in np.atleast_1d(y)], "error_abs": e_abs})
        if k == n_steps: break
        k1 = f(t, y)
        k2 = f(t + h, y + h * k1)
        y = y + (h / 2.0) * (k1 + k2)
        t += h
    return y, historial, True, (time.perf_counter() - t0_cpu)*1000.0

def rk4(f, t0, y0, h, n_steps, f_ref=None):
    t0_cpu = time.perf_counter()
    historial = []
    t, y = t0, np.array(y0, dtype=float)
    for k in range(n_steps + 1):
        e_abs = float(np.linalg.norm(y - np.array(f_ref(t)))) if f_ref else 0.0
        historial.append({"iter": k, "t": round(t, 4), "y": [round(float(v), 6) for v in np.atleast_1d(y)], "error_abs": e_abs})
        if k == n_steps: break
        k1 = f(t, y)
        k2 = f(t + h/2.0, y + (h/2.0) * k1)
        k3 = f(t + h/2.0, y + (h/2.0) * k2)
        k4 = f(t + h, y + h * k3)
        y = y + (h / 6.0) * (k1 + 2*k2 + 2*k3 + k4)
        t += h
    return y, historial, True, (time.perf_counter() - t0_cpu)*1000.0

# ===========================================================================
# --- ALGORITMOS: INTEGRACIÓN E INTERPOLACIÓN (Semana 2) --------------------
# ===========================================================================

def simpson_13_compuesto(f, a, b, n, I_ref=None):
    t0 = time.perf_counter()
    if n % 2 != 0: n += 1 
    h = (b - a) / n
    suma_impares = sum(f(a + i * h) for i in range(1, n, 2))
    suma_pares = sum(f(a + i * h) for i in range(2, n, 2))
    I_aprox = (h / 3.0) * (f(a) + 4 * suma_impares + 2 * suma_pares + f(b))
    e_abs = abs(I_aprox - I_ref) if I_ref else 0.0
    return I_aprox, {"error_abs": e_abs}, True, (time.perf_counter() - t0)*1000.0

def lagrange(x_nodes, y_nodes, x_eval):
    n = len(x_nodes); y_eval = 0.0
    for i in range(n):
        L_i = 1.0
        for j in range(n):
            if i != j: L_i *= (x_eval - x_nodes[j]) / (x_nodes[i] - x_nodes[j])
        y_eval += y_nodes[i] * L_i
    return y_eval

def splines_cubicos(x_nodes, y_nodes, x_eval):
    n = len(x_nodes) - 1; h = np.diff(x_nodes); alpha = np.zeros(n)
    for i in range(1, n): alpha[i] = (3/h[i])*(y_nodes[i+1]-y_nodes[i]) - (3/h[i-1])*(y_nodes[i]-y_nodes[i-1])
    l = np.ones(n+1); mu = np.zeros(n+1); z = np.zeros(n+1)
    for i in range(1, n):
        l[i] = 2*(x_nodes[i+1]-x_nodes[i-1]) - h[i-1]*mu[i-1]
        mu[i] = h[i]/l[i]; z[i] = (alpha[i]-h[i-1]*z[i-1])/l[i]
    c = np.zeros(n+1); b = np.zeros(n); d = np.zeros(n)
    for j in range(n-1, -1, -1):
        c[j] = z[j] - mu[j]*c[j+1]; b[j] = (y_nodes[j+1]-y_nodes[j])/h[j] - h[j]*(c[j+1]+2*c[j])/3
        d[j] = (c[j+1]-c[j])/(3*h[j])
    for i in range(n):
        if x_nodes[i] <= x_eval <= x_nodes[i+1] or i == n-1:
            dx = x_eval - x_nodes[i]
            return y_nodes[i] + b[i]*dx + c[i]*dx**2 + d[i]*dx**3

# ===========================================================================
# --- RUTAS FLASK Y PERSISTENCIA (Web y BD) ---------------------------------
# ===========================================================================

@app.route("/")
def index():
    return render_template("index.html")

def guardar_simulacion_bd(caso_id, tipo, params_dict, resultados_resumen):
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO escenario (caso_id, tipo, parametros_json, fuente_datos) VALUES (?, ?, ?, ?)",
                    (caso_id, tipo, json.dumps(params_dict), "SIMTELE-RISK Engine"))
        esc_id = cur.lastrowid
        cur.execute("INSERT INTO simulacion (escenario_id, usuario_equipo, estado) VALUES (?, ?, ?)",
                    (esc_id, "Equipo SIMTELE-RISK", "COMPLETADO"))
        sim_id = cur.lastrowid
        
        # Guardado simplificado para el historial
        cur.execute("""INSERT INTO ejecucion_metodo (simulacion_id, metodo, tolerancia, paso, max_iter, convergio, tiempo_ms)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""", (sim_id, "Multi-Algoritmo", 1e-6, 0.0, 100, 1, 5.0))
        ejec_id = cur.lastrowid
        cur.execute("""INSERT INTO resultado_resumen (ejecucion_id, referencia, valor_json, metrica_error_json, interpretacion)
                       VALUES (?, ?, ?, ?, ?)""", (ejec_id, "Ref_Exacta", json.dumps(resultados_resumen), "{}", f"Ejecución {tipo}"))
        conn.commit()
    return sim_id

@app.route("/api/ejecutar_m1", methods=["POST"])
def ejecutar_m1():
    tipo = (request.json or {}).get("escenario", "NORMAL")
    if tipo == "NORMAL": v0, a0, h = 6.0, 1.5, 0.1
    elif tipo == "ESTRES": v0, a0, h = 8.5, 0.75, 0.5
    else: v0, a0, h = 6.0, 1.5, 0.25  # Mal condicionado (paso grueso / derivada nula al final)
        
    t_det_ex = v0 / a0; d_frenado_ex = (v0**2) / (2*a0)
    
    # 1. EDO
    def f_dvdt(t, v): return -a0
    def v_ex(t): return max(0.0, v0 - a0 * t)
    def f_raiz(t):
        return (v0 - a0 * t) if tipo != "MAL_CONDICIONADO" else (v0 - a0 * t) * abs(v0 - a0 * t)
    v_rk4, hist_rk4, _, _ = rk4(f_dvdt, 0.0, [v0], h, int(t_det_ex/h) + 2, f_ref=lambda t: [v_ex(t)])
    
    # 2. Raíz (Bisección con cambio de signo genuino)
    t_aprox, hist_bisec, _, _ = biseccion(f_raiz, 0.0, t_det_ex + 2.3, x_ref=t_det_ex)
    
    # 3. Integración (Simpson)
    d_aprox, _, _, _ = simpson_13_compuesto(v_ex, 0.0, t_det_ex, 40, I_ref=d_frenado_ex)
    
    guardar_simulacion_bd(1, tipo, {"v0": v0, "a0": a0, "h": h}, {"t_det": t_aprox, "d_frenado": d_aprox})
    
    return jsonify({
        "escenario": tipo, "referencia": {"t_det": t_det_ex, "d_frenado": d_frenado_ex},
        "edo_rk4": {"historial": hist_rk4}, "raiz_bisec": {"historial": hist_bisec, "resultado": t_aprox},
        "int_simpson": {"resultado": d_aprox}
    })

@app.route("/api/ejecutar_m2", methods=["POST"])
def ejecutar_m2():
    tipo = (request.json or {}).get("escenario", "NORMAL")
    # Sistemas Lineales de Semana 1
    A = np.array([[10., -1., 2., 0.], [-1., 11., -1., 3.], [2., -1., 10., -1.], [0., 3., -1., 8.]])
    x_ex = np.array([1., 2., -1., 1.]); b = A @ x_ex
    tol = 1e-10 if tipo == "ESTRES" else 1e-6
    if tipo == "ESTRES": b += np.array([0.05, -0.05, 0.05, -0.05]); x_ex = np.linalg.solve(A, b)
    elif tipo == "MAL_CONDICIONADO": 
        A = np.array([[1.0/(i+j+1) for j in range(4)] for i in range(4)]) + 1e-4*np.eye(4)
        b = A @ x_ex
        
    metodos = {}
    for nom, fn in [("Jacobi", solve_jacobi), ("Gauss-Seidel", solve_gauss_seidel), ("Gradiente Conjugado", solve_conjugate_gradient), ("Factorización LU", lambda A, b, x_ex, tol=tol: solve_lu(A, b, x_ex))]:
        x_sol, hist, conv, _ = fn(A, b, x_ex, tol=tol)
        metodos[nom] = {"solucion": [round(float(v),6) for v in x_sol], "convergio": conv, "error_abs": hist[-1]["error_abs"] if hist else 0.0, "historial": hist[:25], "iteraciones_totales": len(hist)}

    # Raíces D(t) - Dumbral = 0 (Añadido en Semana 2)
    D0, alpha, beta, D_umbral = 10.0, 3.5, 0.75, 75.0
    def f_det(t): return D0 + alpha*t + beta*t**2 - D_umbral
    def df_det(t): return alpha + 2*beta*t
    t_ex_raiz = (-alpha + np.sqrt(alpha**2 - 4*beta*(D0 - D_umbral))) / (2*beta)
    
    t_newton, hist_newton, _, _ = newton_raphson(f_det, df_det, 1.0, x_ref=t_ex_raiz)
    
    guardar_simulacion_bd(2, tipo, {"k(A)": float(np.linalg.cond(A))}, {"raiz_mantenimiento": t_newton})

    return jsonify({
        "escenario": tipo, "condicion": round(float(np.linalg.cond(A)), 2), "referencia": [round(float(v),4) for v in x_ex],
        "metodos": metodos, "raiz_newton": {"resultado": t_newton, "historial": hist_newton, "exacto": t_ex_raiz}
    })

@app.route("/api/ejecutar_m3", methods=["POST"])
def ejecutar_m3():
    tipo = (request.json or {}).get("escenario", "NORMAL")
    m, c, k = 800.0, 320.0, 1280.0 # Subamortiguado
    if tipo == "ESTRES": c = 80.0
    elif tipo == "MAL_CONDICIONADO": c = 16.0  # Cuasi-resonancia (amortiguamiento mínimo)
    
    w0 = np.sqrt(k/m); zeta = c/(2*np.sqrt(m*k)); wd = w0*np.sqrt(1 - zeta**2)
    def x_ex(t): return np.exp(-zeta*w0*t) * (0.35 * np.cos(wd*t) + (zeta*w0*0.35)/wd * np.sin(wd*t))
    
    # Sistema EDO 2do orden -> 1er orden: y = [x, v]
    def f_osc(t, y): return np.array([y[1], (-c*y[1] - k*y[0])/m])
    
    y_rk4, hist_rk4, _, _ = rk4(f_osc, 0.0, [0.35, 0.0], 0.05, 100, f_ref=lambda t: [x_ex(t), 0])
    
    # Integración Energía
    def f_energia(t): return x_ex(t)**2
    E_aprox, _, _, _ = simpson_13_compuesto(f_energia, 0.0, 5.0, 40)
    
    guardar_simulacion_bd(3, tipo, {"c": c, "k": k}, {"energia": E_aprox})
    
    return jsonify({"escenario": tipo, "edo_rk4": {"historial": hist_rk4}, "energia": E_aprox})

@app.route("/api/ejecutar_m4", methods=["POST"])
def ejecutar_m4():
    tipo = (request.json or {}).get("escenario", "NORMAL")
    x_nodes = np.linspace(0, 6, 7 if tipo != "MAL_CONDICIONADO" else 13).tolist()
    def y_exact(t): return np.exp(-0.2*t)*np.sin(t) + 2.0
    rng = np.random.default_rng(42)
    y_nodes = [float(y_exact(x) + (rng.normal(0, 0.05) if tipo=="ESTRES" else 0.0)) for x in x_nodes]
    
    x_eval = np.linspace(0, 6, 49).tolist()
    y_ref = [float(y_exact(x)) for x in x_eval]
    y_lag = [float(lagrange(x_nodes, y_nodes, x)) for x in x_eval]
    y_spl = [float(splines_cubicos(x_nodes, y_nodes, x)) for x in x_eval]
    
    rmse_lag = float(np.sqrt(np.mean((np.array(y_lag) - np.array(y_ref))**2)))
    rmse_spl = float(np.sqrt(np.mean((np.array(y_spl) - np.array(y_ref))**2)))
    
    guardar_simulacion_bd(4, tipo, {"nodos": len(x_nodes)}, {"rmse_splines": rmse_spl})
    
    return jsonify({"escenario": tipo, "nodos": {"x": x_nodes, "y": y_nodes}, "curvas": {"x": x_eval, "ref": y_ref, "lag": y_lag, "spl": y_spl}, "errores": {"lag": rmse_lag, "spl": rmse_spl}})

@app.route("/api/historial", methods=["GET"])
def obtener_historial():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("""SELECT s.id AS sim_id, s.fecha, e.tipo, c.nombre AS caso
                       FROM simulacion s JOIN escenario e ON s.escenario_id = e.id
                       JOIN caso_estudio c ON e.caso_id = c.id ORDER BY s.id DESC LIMIT 15""")
        return jsonify([dict(r) for r in cur.fetchall()])

if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)