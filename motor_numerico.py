"""Motor numérico puro para SIMTELE-RISK (Semana 3).

Implementa los cuatro módulos obligatorios con teoría de errores transversal,
validación de parámetros, análisis de sensibilidad y escenarios NORMAL, ESTRES y
MAL_CONDICIONADO.
"""

from __future__ import annotations

import copy
import math
import time
from typing import Any

import numpy as np

AVISOS_GENERALES = [
    "Los datos y parámetros empleados son sintéticos y supuestos para fines académicos.",
    "Los escenarios son hipotéticos (inspirados en sistemas de transporte por cable) y no describen fallas reales.",
    "Aplicación estrictamente educativa: sin conexión ni control sobre equipos físicos reales.",
]

PRESETS: dict[int, dict[str, dict[str, Any]]] = {
    1: {
        "NORMAL": {
            "v0": 6.0,
            "a0": 1.5,
            "b": 0.05,
            "t_r": 0.5,
            "d_disp": 25.0,
            "h": 0.1,
            "n": 16,
            "tol": 1e-8,
            "max_iter": 100,
            "formulacion": "simple",
        },
        "ESTRES": {
            "v0": 8.5,
            "a0": 0.75,
            "b": 0.02,
            "t_r": 1.0,
            "d_disp": 25.0,
            "h": 0.5,
            "n": 4,
            "tol": 1e-8,
            "max_iter": 100,
            "formulacion": "simple",
        },
        "MAL_CONDICIONADO": {
            "v0": 6.0,
            "a0": 1.5,
            "b": 0.05,
            "t_r": 0.5,
            "d_disp": 25.0,
            "h": 0.1,
            "n": 16,
            "tol": 1e-8,
            "max_iter": 100,
            "formulacion": "doble",
        },
    },
    2: {
        "NORMAL": {
            "sistema": "base",
            "delta_b": 0.0,
            "tol_sl": 1e-6,
            "max_iter_sl": 500,
            "D0": 10.0,
            "alpha": 3.5,
            "beta": 0.75,
            "d_umbral": 75.0,
            "retraso": 1.0,
            "tol_raiz": 1e-8,
            "max_iter_raiz": 100,
        },
        "ESTRES": {
            "sistema": "base",
            "delta_b": 0.05,
            "tol_sl": 1e-10,
            "max_iter_sl": 500,
            "D0": 10.0,
            "alpha": 6.0,
            "beta": 1.2,
            "d_umbral": 75.0,
            "retraso": 2.0,
            "tol_raiz": 1e-10,
            "max_iter_raiz": 100,
        },
        "MAL_CONDICIONADO": {
            "sistema": "hilbert",
            "delta_b": 0.0,
            "tol_sl": 1e-8,
            "max_iter_sl": 2000,
            "D0": 10.0,
            "alpha": 8.0,
            "beta": -0.5,
            "d_umbral": 41.9999,
            "retraso": 0.5,
            "tol_raiz": 1e-10,
            "max_iter_raiz": 100,
        },
    },
    3: {
        "NORMAL": {
            "m": 800.0,
            "c": 320.0,
            "k": 1280.0,
            "x0": 0.35,
            "v0": 0.0,
            "F0": 0.0,
            "wf": 0.0,
            "T": 10.0,
            "h": 0.05,
            "n": 64,
            "tol_romberg": 1e-8,
        },
        "ESTRES": {
            "m": 800.0,
            "c": 80.0,
            "k": 1280.0,
            "x0": 0.35,
            "v0": 0.0,
            "F0": 200.0,
            "wf": 1.2,
            "T": 40.0,
            "h": 0.25,
            "n": 64,
            "tol_romberg": 1e-8,
        },
        "MAL_CONDICIONADO": {
            "m": 800.0,
            "c": 8.0,
            "k": 1280.0,
            "x0": 0.35,
            "v0": 0.0,
            "F0": 200.0,
            "wf": 1.264911,
            "T": 40.0,
            "h": 0.1,
            "n": 64,
            "tol_romberg": 1e-8,
        },
    },
    4: {
        "NORMAL": {
            "n_nodos": 7,
            "t_fin": 6.0,
            "distribucion": "equiespaciados",
            "sigma": 0.0,
            "y_umbral": 2.5,
        },
        "ESTRES": {
            "n_nodos": 7,
            "t_fin": 6.0,
            "distribucion": "equiespaciados",
            "sigma": 0.05,
            "y_umbral": 2.5,
        },
        "MAL_CONDICIONADO": {
            "n_nodos": 21,
            "t_fin": 12.0,
            "distribucion": "equiespaciados",
            "sigma": 0.01,
            "y_umbral": 2.5,
        },
    },
}

_INT_FIELDS = {"n", "max_iter", "max_iter_sl", "max_iter_raiz", "n_nodos"}
_STR_FIELDS = {"formulacion", "sistema", "distribucion"}


def _es_numero_finito(val: Any) -> bool:
    if isinstance(val, bool) or val is None:
        return False
    try:
        num = float(val)
    except (TypeError, ValueError):
        return False
    return math.isfinite(num)


def _es_entero(val: Any) -> bool:
    if not _es_numero_finito(val):
        return False
    num = float(val)
    return abs(num - round(num)) < 1e-12


def _norm_inf(vec: list[float]) -> float:
    return max((abs(x) for x in vec), default=0.0)


def _norm_2(vec: list[float]) -> float:
    return math.sqrt(sum(x * x for x in vec))


def _calcular_errores(aprox: Any, ref: Any) -> tuple[float | None, float | None, float | None]:
    if ref is None or aprox is None:
        return None, None, None
    if isinstance(aprox, list) and isinstance(ref, list):
        if len(aprox) != len(ref):
            return None, None, None
        diff = [abs(float(a) - float(r)) for a, r in zip(aprox, ref)]
        e_abs = _norm_inf(diff)
        n_ref = _norm_inf([float(r) for r in ref])
    else:
        e_abs = abs(float(aprox) - float(ref))
        n_ref = abs(float(ref))
    e_rel = (e_abs / n_ref) if n_ref > 1e-12 else None
    e_pct = (e_rel * 100.0) if e_rel is not None else None
    return e_abs, e_rel, e_pct


def _recortar_iteraciones(iters: list[dict[str, Any]], es_edo: bool = False) -> list[dict[str, Any]]:
    total = len(iters)
    if total <= 200:
        return iters
    if es_edo:
        step = max(1, math.ceil(total / 200))
        rec = iters[0::step]
        if rec[-1] is not iters[-1]:
            rec.append(iters[-1])
        return rec
    return iters[:199] + [iters[-1]]


def _submuestrear_indices(total: int, max_pts: int = 1000) -> list[int]:
    if total <= max_pts:
        return list(range(total))
    step = max(1, math.ceil(total / max_pts))
    idx = list(range(0, total, step))
    if idx[-1] != total - 1:
        idx.append(total - 1)
    return idx


def _coercer_params(modulo: int, escenario: str, params: dict[str, Any] | None) -> dict[str, Any]:
    base = copy.deepcopy(PRESETS[modulo][escenario])
    if params:
        for k, v in params.items():
            if k in base:
                base[k] = v
    for k, v in list(base.items()):
        if k in _STR_FIELDS:
            base[k] = str(v) if v is not None else ""
        elif k in _INT_FIELDS:
            if _es_entero(v):
                base[k] = int(round(float(v)))
        else:
            if _es_numero_finito(v):
                base[k] = float(v)
    return base


def _raiz_cuadratica_m2(D0: float, alpha: float, beta: float, d_umbral: float) -> float | None:
    c_term = D0 - d_umbral
    if abs(beta) < 1e-14:
        if abs(alpha) < 1e-14:
            return None
        t_lin = -c_term / alpha
        return t_lin if t_lin >= 0.0 else None
    disc = alpha * alpha - 4.0 * beta * c_term
    if disc < 0.0:
        return None
    sq = math.sqrt(max(0.0, disc))
    r1 = (-alpha - sq) / (2.0 * beta)
    r2 = (-alpha + sq) / (2.0 * beta)
    cand = [r for r in (r1, r2) if r >= -1e-12]
    if not cand:
        return None
    return max(0.0, min(cand))


def validar(modulo: int | str, params: dict[str, Any]) -> list[str]:
    """Valida los parámetros de un módulo y devuelve lista de mensajes de error."""
    try:
        mod = int(modulo)
    except (TypeError, ValueError):
        return ["Módulo inválido (debe ser 1, 2, 3 o 4)."]
    if mod not in PRESETS:
        return ["Módulo inválido (debe ser 1, 2, 3 o 4)."]
    if not isinstance(params, dict):
        return ["Los parámetros deben ser un objeto."]

    errs: list[str] = []

    if mod == 1:
        req_num = ("v0", "a0", "b", "t_r", "d_disp", "h", "n", "tol", "max_iter")
        for k in req_num:
            if k not in params or not _es_numero_finito(params[k]):
                errs.append(f"El parámetro '{k}' debe ser un número finito.")
        if errs:
            return errs
        v0 = float(params["v0"])
        a0 = float(params["a0"])
        b = float(params["b"])
        t_r = float(params["t_r"])
        d_disp = float(params["d_disp"])
        h = float(params["h"])
        tol = float(params["tol"])
        form = str(params.get("formulacion", ""))
        if not (0.0 < v0 <= 20.0):
            errs.append("v0 debe cumplir 0 < v0 <= 20.")
        if not (0.0 < a0 <= 5.0):
            errs.append("a0 debe cumplir 0 < a0 <= 5.")
        if not (0.0 <= b <= 1.0):
            errs.append("b debe cumplir 0 <= b <= 1.")
        if not (0.0 <= t_r <= 5.0):
            errs.append("t_r debe cumplir 0 <= t_r <= 5.")
        if not (d_disp > 0.0):
            errs.append("d_disp debe ser mayor que 0.")
        if not (0.0 < h <= 1.0):
            errs.append("h debe cumplir 0 < h <= 1.")
        if not _es_entero(params["n"]):
            errs.append("n debe ser un entero par entre 2 y 1024.")
        else:
            n_val = int(round(float(params["n"])))
            if n_val < 2 or n_val > 1024 or n_val % 2 != 0:
                errs.append("n debe ser un entero par entre 2 y 1024.")
        if not (1e-14 <= tol <= 1e-2):
            errs.append("tol debe cumplir 1e-14 <= tol <= 1e-2.")
        if not _es_entero(params["max_iter"]):
            errs.append("max_iter debe ser un entero entre 1 y 1000.")
        else:
            mi = int(round(float(params["max_iter"])))
            if mi < 1 or mi > 1000:
                errs.append("max_iter debe ser un entero entre 1 y 1000.")
        if form not in ("simple", "doble"):
            errs.append("formulacion debe ser 'simple' o 'doble'.")

    elif mod == 2:
        req_num = ("delta_b", "tol_sl", "max_iter_sl", "D0", "alpha", "beta", "d_umbral", "retraso", "tol_raiz", "max_iter_raiz")
        for k in req_num:
            if k not in params or not _es_numero_finito(params[k]):
                errs.append(f"El parámetro '{k}' debe ser un número finito.")
        if errs:
            return errs
        sistema = str(params.get("sistema", ""))
        delta_b = float(params["delta_b"])
        tol_sl = float(params["tol_sl"])
        D0 = float(params["D0"])
        alpha = float(params["alpha"])
        beta = float(params["beta"])
        d_umbral = float(params["d_umbral"])
        retraso = float(params["retraso"])
        tol_raiz = float(params["tol_raiz"])
        if sistema not in ("base", "hilbert"):
            errs.append("sistema debe ser 'base' o 'hilbert'.")
        if not (0.0 <= delta_b <= 1.0):
            errs.append("delta_b debe cumplir 0 <= delta_b <= 1.")
        if not (1e-14 <= tol_sl <= 1e-2):
            errs.append("tol_sl debe cumplir 1e-14 <= tol_sl <= 1e-2.")
        if not _es_entero(params["max_iter_sl"]) or not (1 <= int(round(float(params["max_iter_sl"]))) <= 5000):
            errs.append("max_iter_sl debe ser un entero entre 1 y 5000.")
        if not (D0 < d_umbral):
            errs.append("D0 debe ser menor que d_umbral.")
        if retraso < 0.0:
            errs.append("retraso debe ser mayor o igual a 0.")
        if not (1e-14 <= tol_raiz <= 1e-2):
            errs.append("tol_raiz debe cumplir 1e-14 <= tol_raiz <= 1e-2.")
        if not _es_entero(params["max_iter_raiz"]) or not (1 <= int(round(float(params["max_iter_raiz"]))) <= 1000):
            errs.append("max_iter_raiz debe ser un entero entre 1 y 1000.")
        if D0 < d_umbral and _raiz_cuadratica_m2(D0, alpha, beta, d_umbral) is None:
            errs.append("El indicador nunca alcanza el umbral con estos parámetros.")

    elif mod == 3:
        req_num = ("m", "c", "k", "x0", "v0", "F0", "wf", "T", "h", "n", "tol_romberg")
        for k_name in req_num:
            if k_name not in params or not _es_numero_finito(params[k_name]):
                errs.append(f"El parámetro '{k_name}' debe ser un número finito.")
        if errs:
            return errs
        m = float(params["m"])
        c = float(params["c"])
        k_val = float(params["k"])
        F0 = float(params["F0"])
        wf = float(params["wf"])
        T = float(params["T"])
        h = float(params["h"])
        tol_r = float(params["tol_romberg"])
        if m <= 0.0:
            errs.append("m debe ser mayor que 0.")
        if k_val <= 0.0:
            errs.append("k debe ser mayor que 0.")
        if c < 0.0:
            errs.append("c debe ser >= 0.")
        if F0 < 0.0:
            errs.append("F0 debe ser >= 0.")
        if wf < 0.0:
            errs.append("wf debe ser >= 0.")
        if T <= 0.0:
            errs.append("T debe ser mayor que 0.")
        if h <= 0.0:
            errs.append("h debe ser mayor que 0.")
        if T > 0.0 and h > 0.0:
            n_steps = round(T / h)
            if abs(n_steps * h - T) >= 1e-9 * T:
                errs.append("T debe ser múltiplo de h.")
            elif n_steps < 10 or n_steps > 4000:
                errs.append("El número de pasos N = T/h debe estar entre 10 y 4000.")
        if not _es_entero(params["n"]):
            errs.append("n debe ser una potencia de 2 entre 2 y 1024.")
        else:
            n_val = int(round(float(params["n"])))
            if n_val < 2 or n_val > 1024 or (n_val & (n_val - 1)) != 0:
                errs.append("n debe ser una potencia de 2 entre 2 y 1024.")
        if not (1e-14 <= tol_r <= 1e-2):
            errs.append("tol_romberg debe cumplir 1e-14 <= tol_romberg <= 1e-2.")

    elif mod == 4:
        req_num = ("n_nodos", "t_fin", "sigma", "y_umbral")
        for k_name in req_num:
            if k_name not in params or not _es_numero_finito(params[k_name]):
                errs.append(f"El parámetro '{k_name}' debe ser un número finito.")
        if errs:
            return errs
        t_fin = float(params["t_fin"])
        sigma = float(params["sigma"])
        dist = str(params.get("distribucion", ""))
        if not _es_entero(params["n_nodos"]):
            errs.append("n_nodos debe ser un entero entre 3 y 30.")
        else:
            nn = int(round(float(params["n_nodos"])))
            if nn < 3 or nn > 30:
                errs.append("n_nodos debe ser un entero entre 3 y 30.")
        if not (0.0 < t_fin <= 30.0):
            errs.append("t_fin debe cumplir 0 < t_fin <= 30.")
        if not (0.0 <= sigma <= 0.5):
            errs.append("sigma debe cumplir 0 <= sigma <= 0.5.")
        if dist not in ("equiespaciados", "chebyshev"):
            errs.append("distribucion debe ser 'equiespaciados' o 'chebyshev'.")

    return errs


# ===========================================================================
# --- MÓDULO 1: DETENCIÓN DE EMERGENCIA DE CABINAS --------------------------
# ===========================================================================

def _m1_analitica(v0: float, a0: float, b: float) -> tuple[Any, Any, float, float]:
    if b > 1e-12:
        K = v0 + a0 / b
        t_det = math.log(1.0 + b * v0 / a0) / b

        def v_ex(t: float) -> float:
            return K * math.exp(-b * t) - a0 / b

        def x_ex(t: float) -> float:
            return K * (1.0 - math.exp(-b * t)) / b - (a0 / b) * t
    else:
        t_det = v0 / a0

        def v_ex(t: float) -> float:
            return v0 - a0 * t

        def x_ex(t: float) -> float:
            return v0 * t - 0.5 * a0 * t * t

    d_fren = x_ex(t_det)
    return v_ex, x_ex, t_det, d_fren


def _m1_edo(metodo: str, a0: float, b: float, v0: float, h: float, t_det: float, x_ex: Any, v_ex: Any):
    t0_cpu = time.perf_counter()
    N = max(1, math.ceil(t_det / h - 1e-12))
    t = 0.0
    x = 0.0
    v = v0
    iters: list[dict[str, Any]] = []
    ts: list[float] = []
    xs: list[float] = []
    vs: list[float] = []
    rx_list: list[float] = []
    rv_list: list[float] = []
    errs_list: list[float] = []

    for k in range(N + 1):
        rx = x_ex(t)
        rv = v_ex(t)
        e_abs, e_rel, _ = _calcular_errores([x, v], [rx, rv])
        iters.append({
            "n": k,
            "t": t,
            "aprox": [x, v],
            "residual": None,
            "error_abs": e_abs,
            "error_rel": e_rel,
        })
        ts.append(t)
        xs.append(x)
        vs.append(v)
        rx_list.append(rx)
        rv_list.append(rv)
        errs_list.append(e_abs if e_abs is not None else 0.0)
        if k == N:
            break
        t_next = t_det if k == N - 1 else (k + 1) * h
        hk = t_next - t
        if metodo == "rk2":
            k1x = v
            k1v = -(a0 + b * v)
            xp = x + hk * k1x
            vp = v + hk * k1v
            k2x = vp
            k2v = -(a0 + b * vp)
            x = x + 0.5 * hk * (k1x + k2x)
            v = v + 0.5 * hk * (k1v + k2v)
        else:
            k1x = v
            k1v = -(a0 + b * v)
            x2 = x + 0.5 * hk * k1x
            v2 = v + 0.5 * hk * k1v
            k2x = v2
            k2v = -(a0 + b * v2)
            x3 = x + 0.5 * hk * k2x
            v3 = v + 0.5 * hk * k2v
            k3x = v3
            k3v = -(a0 + b * v3)
            x4 = x + hk * k3x
            v4 = v + hk * k3v
            k4x = v4
            k4v = -(a0 + b * v4)
            x = x + (hk / 6.0) * (k1x + 2.0 * k2x + 2.0 * k3x + k4x)
            v = v + (hk / 6.0) * (k1v + 2.0 * k2v + 2.0 * k3v + k4v)
        t = t_next

    ms = (time.perf_counter() - t0_cpu) * 1000.0
    return {
        "final": [x, v],
        "iters": iters,
        "ts": ts,
        "xs": xs,
        "vs": vs,
        "rx": rx_list,
        "rv": rv_list,
        "errs": errs_list,
        "ms": ms,
    }


def _trapecio_fn(f: Any, a: float, b_lim: float, n: int) -> float:
    h = (b_lim - a) / n
    s = 0.5 * (f(a) + f(b_lim))
    for i in range(1, n):
        s += f(a + i * h)
    return s * h


def _simpson_fn(f: Any, a: float, b_lim: float, n: int) -> float:
    if n % 2 != 0:
        n += 1
    h = (b_lim - a) / n
    s_imp = 0.0
    s_par = 0.0
    for i in range(1, n, 2):
        s_imp += f(a + i * h)
    for i in range(2, n, 2):
        s_par += f(a + i * h)
    return (h / 3.0) * (f(a) + 4.0 * s_imp + 2.0 * s_par + f(b_lim))


def _romberg_fn(f: Any, a: float, b_lim: float, tol: float, max_niveles: int = 10):
    t0_cpu = time.perf_counter()
    R: list[list[float]] = []
    diag_rows: list[dict[str, Any]] = []
    convergio = False
    criterio = f"máximo de {max_niveles} niveles alcanzado"

    for k in range(max_niveles):
        n_int = 1 << k
        row = [0.0] * (k + 1)
        if k == 0:
            row[0] = 0.5 * (b_lim - a) * (f(a) + f(b_lim))
        else:
            h_k = (b_lim - a) / n_int
            s_mid = 0.0
            for i in range(1, n_int, 2):
                s_mid += f(a + i * h_k)
            row[0] = 0.5 * R[k - 1][0] + h_k * s_mid
            pow4 = 4.0
            for j in range(1, k + 1):
                row[j] = row[j - 1] + (row[j - 1] - R[k - 1][j - 1]) / (pow4 - 1.0)
                pow4 *= 4.0
        R.append(row)
        res = abs(row[k] - R[k - 1][k - 1]) if k > 0 else None
        diag_rows.append({"n": k + 1, "subintervalos": n_int, "aprox": row[k], "residual": res})
        if k > 0 and res is not None and res < tol:
            convergio = True
            criterio = f"|R[k,k]-R[k-1,k-1]| < {tol}"
            break

    ms = (time.perf_counter() - t0_cpu) * 1000.0
    return R[-1][-1], diag_rows, R, convergio, criterio, ms


def _m1_simpson_total(v0: float, a0: float, b: float, t_r: float, n: int) -> float:
    v_ex, _, t_det, _ = _m1_analitica(v0, a0, b)
    return v0 * t_r + _simpson_fn(v_ex, 0.0, t_det, n)


def _resolver_raiz_biseccion(f: Any, a: float, b_lim: float, tol: float, max_iter: int, ref: float | None):
    t0_cpu = time.perf_counter()
    fa = f(a)
    fb = f(b_lim)
    iters: list[dict[str, Any]] = []
    if fa * fb > 0.0:
        return a, iters, False, "sin cambio de signo en el intervalo", (time.perf_counter() - t0_cpu) * 1000.0
    lo, hi = a, b_lim
    flo = fa
    c = lo
    convergio = False
    criterio = f"máximo de {max_iter} iteraciones alcanzado"
    for k in range(1, max_iter + 1):
        c = 0.5 * (lo + hi)
        fc = f(c)
        e_abs, e_rel, _ = _calcular_errores(c, ref)
        iters.append({
            "n": k,
            "aprox": c,
            "residual": abs(fc),
            "error_abs": e_abs,
            "error_rel": e_rel,
            "a": lo,
            "b": hi,
        })
        if abs(fc) < tol or 0.5 * (hi - lo) < tol:
            convergio = True
            criterio = f"|f(c)| < {tol} o semiancho < {tol}"
            break
        if flo * fc <= 0.0:
            hi = c
        else:
            lo = c
            flo = fc
    ms = (time.perf_counter() - t0_cpu) * 1000.0
    return c, iters, convergio, criterio, ms


def _resolver_raiz_newton(f: Any, df: Any, x0: float, tol: float, max_iter: int, ref: float | None):
    t0_cpu = time.perf_counter()
    x = x0
    iters: list[dict[str, Any]] = []
    convergio = False
    criterio = f"máximo de {max_iter} iteraciones alcanzado"
    for k in range(1, max_iter + 1):
        fx = f(x)
        dfx = df(x)
        if abs(dfx) < 1e-14:
            criterio = "derivada nula (|f'| < 1e-14)"
            convergio = False
            break
        x_new = x - fx / dfx
        if not math.isfinite(x_new):
            criterio = "valor no finito"
            convergio = False
            break
        fx_new = f(x_new)
        e_abs, e_rel, _ = _calcular_errores(x_new, ref)
        iters.append({
            "n": k,
            "aprox": x_new,
            "residual": abs(fx_new),
            "error_abs": e_abs,
            "error_rel": e_rel,
        })
        if abs(x_new - x) < tol or abs(fx_new) < tol:
            x = x_new
            convergio = True
            criterio = f"|Δx| < {tol} o |f(x)| < {tol}"
            break
        x = x_new
    ms = (time.perf_counter() - t0_cpu) * 1000.0
    return x, iters, convergio, criterio, ms


def _resolver_raiz_secante(f: Any, x0: float, x1: float, tol: float, max_iter: int, ref: float | None):
    t0_cpu = time.perf_counter()
    a, b_pt = x0, x1
    fa, fb = f(a), f(b_pt)
    iters: list[dict[str, Any]] = []
    convergio = False
    criterio = f"máximo de {max_iter} iteraciones alcanzado"
    for k in range(1, max_iter + 1):
        den = fb - fa
        if abs(den) < 1e-14:
            criterio = "denominador nulo (|f(x1)-f(x0)| < 1e-14)"
            convergio = False
            break
        x_new = b_pt - fb * (b_pt - a) / den
        if not math.isfinite(x_new):
            criterio = "valor no finito"
            convergio = False
            break
        f_new = f(x_new)
        e_abs, e_rel, _ = _calcular_errores(x_new, ref)
        iters.append({
            "n": k,
            "aprox": x_new,
            "residual": abs(f_new),
            "error_abs": e_abs,
            "error_rel": e_rel,
        })
        if abs(x_new - b_pt) < tol or abs(f_new) < tol:
            b_pt = x_new
            convergio = True
            criterio = f"|Δx| < {tol} o |f(x)| < {tol}"
            break
        a, fa = b_pt, fb
        b_pt, fb = x_new, f_new
    ms = (time.perf_counter() - t0_cpu) * 1000.0
    return b_pt, iters, convergio, criterio, ms


def _ejecutar_m1(escenario: str, p: dict[str, Any]) -> dict[str, Any]:
    v0 = float(p["v0"])
    a0 = float(p["a0"])
    b = float(p["b"])
    t_r = float(p["t_r"])
    d_disp = float(p["d_disp"])
    h = float(p["h"])
    n = int(p["n"])
    tol = float(p["tol"])
    max_iter = int(p["max_iter"])
    formulacion = str(p["formulacion"])

    v_ex, x_ex, t_det, d_fren = _m1_analitica(v0, a0, b)
    d_total_ref = v0 * t_r + d_fren
    t_total = t_r + t_det
    ref_edo = [d_fren, 0.0]

    # EDOs + orden observado
    res_rk2 = _m1_edo("rk2", a0, b, v0, h, t_det, x_ex, v_ex)
    res_rk4 = _m1_edo("rk4", a0, b, v0, h, t_det, x_ex, v_ex)
    res_rk2_half = _m1_edo("rk2", a0, b, v0, h / 2.0, t_det, x_ex, v_ex)
    res_rk4_half = _m1_edo("rk4", a0, b, v0, h / 2.0, t_det, x_ex, v_ex)

    e_rk2_h, er_rk2_h, ep_rk2_h = _calcular_errores(res_rk2["final"], ref_edo)
    e_rk4_h, er_rk4_h, ep_rk4_h = _calcular_errores(res_rk4["final"], ref_edo)
    e_rk2_h2, _, _ = _calcular_errores(res_rk2_half["final"], ref_edo)
    e_rk4_h2, _, _ = _calcular_errores(res_rk4_half["final"], ref_edo)

    orden_rk2 = math.log2(e_rk2_h / e_rk2_h2) if (e_rk2_h and e_rk2_h2 and e_rk2_h > 1e-13 and e_rk2_h2 > 1e-13) else None
    orden_rk4 = math.log2(e_rk4_h / e_rk4_h2) if (e_rk4_h and e_rk4_h2 and e_rk4_h > 1e-13 and e_rk4_h2 > 1e-13) else None

    # Integración y refinamiento
    ns_ref: list[int] = []
    cur_n = 2
    while cur_n < n:
        ns_ref.append(cur_n)
        cur_n *= 2
    ns_ref.append(n)

    refinamiento: list[dict[str, Any]] = []
    iters_trap: list[dict[str, Any]] = []
    iters_simp: list[dict[str, Any]] = []

    t0_tr = time.perf_counter()
    for idx, nk in enumerate(ns_ref, start=1):
        val_t = _trapecio_fn(v_ex, 0.0, t_det, nk)
        et_abs, et_rel, _ = _calcular_errores(val_t, d_fren)
        iters_trap.append({"n": idx, "subintervalos": nk, "aprox": val_t, "residual": None, "error_abs": et_abs, "error_rel": et_rel})
        refinamiento.append({"n": nk, "trapecio": val_t, "err_trap": et_abs, "simpson": 0.0, "err_simp": 0.0})
    ms_trap = (time.perf_counter() - t0_tr) * 1000.0

    t0_sp = time.perf_counter()
    for idx, nk in enumerate(ns_ref, start=1):
        val_s = _simpson_fn(v_ex, 0.0, t_det, nk)
        es_abs, es_rel, _ = _calcular_errores(val_s, d_fren)
        iters_simp.append({"n": idx, "subintervalos": nk, "aprox": val_s, "residual": None, "error_abs": es_abs, "error_rel": es_rel})
        refinamiento[idx - 1]["simpson"] = val_s
        refinamiento[idx - 1]["err_simp"] = es_abs
    ms_simp = (time.perf_counter() - t0_sp) * 1000.0

    I_trap = refinamiento[-1]["trapecio"]
    I_simp = refinamiento[-1]["simpson"]
    e_tr_abs, e_tr_rel, e_tr_pct = _calcular_errores(I_trap, d_fren)
    e_sp_abs, e_sp_rel, e_sp_pct = _calcular_errores(I_simp, d_fren)

    I_romb, romb_rows, romb_table, romb_conv, romb_crit, ms_romb = _romberg_fn(v_ex, 0.0, t_det, tol)
    for r in romb_rows:
        ea, er, _ = _calcular_errores(r["aprox"], d_fren)
        r["error_abs"] = ea
        r["error_rel"] = er
    e_rm_abs, e_rm_rel, e_rm_pct = _calcular_errores(I_romb, d_fren)

    # Raíces
    def f_raiz(t: float) -> float:
        vt = v_ex(t)
        return vt if formulacion == "simple" else vt * abs(vt)

    def df_raiz(t: float) -> float:
        vt = v_ex(t)
        dv = -(a0 + b * vt)
        return dv if formulacion == "simple" else 2.0 * abs(vt) * dv

    upper_b = v0 / a0 + 1.0
    t_bis, it_bis, conv_bis, crit_bis, ms_bis = _resolver_raiz_biseccion(f_raiz, 0.0, upper_b, tol, max_iter, t_det)
    t_new, it_new, conv_new, crit_new, ms_new = _resolver_raiz_newton(f_raiz, df_raiz, 0.0, tol, max_iter, t_det)
    t_sec, it_sec, conv_sec, crit_sec, ms_sec = _resolver_raiz_secante(f_raiz, 0.0, v0 / a0, tol, max_iter, t_det)

    eb_abs, eb_rel, eb_pct = _calcular_errores(t_bis, t_det)
    en_abs, en_rel, en_pct = _calcular_errores(t_new, t_det)
    es_abs, es_rel, es_pct = _calcular_errores(t_sec, t_det)

    derivada_en_raiz = abs(df_raiz(t_det))
    d_total_num = v0 * t_r + I_simp
    margen = d_disp - d_total_num
    cumple = d_total_num <= d_disp

    # Sensibilidad de d_total_num (+1%)
    sensibilidad: list[dict[str, Any]] = []
    for pname, pval in (("v0", v0), ("a0", a0), ("b", b), ("t_r", t_r)):
        if pval == 0.0:
            sensibilidad.append({
                "parametro": pname,
                "salida": "d_total_num",
                "base": d_total_num,
                "perturbado": d_total_num,
                "S": None,
                "tipo": "relativa",
                "nota": "parámetro nulo",
            })
        else:
            kw = {"v0": v0, "a0": a0, "b": b, "t_r": t_r}
            kw[pname] = pval * 1.01
            out_pert = _m1_simpson_total(kw["v0"], kw["a0"], kw["b"], kw["t_r"], n)
            S_val = ((out_pert - d_total_num) / d_total_num) / 0.01 if abs(d_total_num) > 1e-14 else None
            sensibilidad.append({
                "parametro": pname,
                "salida": "d_total_num",
                "base": d_total_num,
                "perturbado": out_pert,
                "S": S_val,
                "tipo": "relativa",
                "nota": None,
            })

    # Series
    idx_s = _submuestrear_indices(len(res_rk4["ts"]), 1000)
    # Nota: si h es el mismo para rk2 y rk4, los arreglos tienen igual longitud
    series = {
        "t": [res_rk4["ts"][i] for i in idx_s],
        "rk2_x": [res_rk2["xs"][i] for i in idx_s],
        "rk2_v": [res_rk2["vs"][i] for i in idx_s],
        "rk4_x": [res_rk4["xs"][i] for i in idx_s],
        "rk4_v": [res_rk4["vs"][i] for i in idx_s],
        "ref_x": [res_rk4["rx"][i] for i in idx_s],
        "ref_v": [res_rk4["rv"][i] for i in idx_s],
        "err_rk2": [res_rk2["errs"][i] for i in idx_s],
        "err_rk4": [res_rk4["errs"][i] for i in idx_s],
    }

    metodos = [
        {
            "id": "rk2",
            "familia": "EDO",
            "nombre": "RK2 (Heun)",
            "tolerancia": None,
            "paso": h,
            "max_iter": None,
            "convergio": True,
            "tiempo_ms": res_rk2["ms"],
            "criterio_parada": f"integración fija en [0, {t_det:.4f}] s",
            "resultado": res_rk2["final"],
            "referencia": ref_edo,
            "error_abs": e_rk2_h,
            "error_rel": er_rk2_h,
            "error_pct": ep_rk2_h,
            "residual": None,
            "iteraciones": _recortar_iteraciones(res_rk2["iters"], es_edo=True),
            "interpretacion": f"Estado final [x, v] con orden global O(h^2); error máximo respecto a solución analítica: {e_rk2_h:.3e}.",
        },
        {
            "id": "rk4",
            "familia": "EDO",
            "nombre": "RK4 (Clásico)",
            "tolerancia": None,
            "paso": h,
            "max_iter": None,
            "convergio": True,
            "tiempo_ms": res_rk4["ms"],
            "criterio_parada": f"integración fija en [0, {t_det:.4f}] s",
            "resultado": res_rk4["final"],
            "referencia": ref_edo,
            "error_abs": e_rk4_h,
            "error_rel": er_rk4_h,
            "error_pct": ep_rk4_h,
            "residual": None,
            "iteraciones": _recortar_iteraciones(res_rk4["iters"], es_edo=True),
            "interpretacion": f"Estado final [x, v] con orden global O(h^4); error máximo respecto a solución analítica: {e_rk4_h:.3e}.",
        },
        {
            "id": "trapecio",
            "familia": "Integración",
            "nombre": "Trapecio compuesto",
            "tolerancia": None,
            "paso": t_det / n,
            "max_iter": n,
            "convergio": True,
            "tiempo_ms": ms_trap,
            "criterio_parada": f"n = {n} subintervalos",
            "resultado": I_trap,
            "referencia": d_fren,
            "error_abs": e_tr_abs,
            "error_rel": e_tr_rel,
            "error_pct": e_tr_pct,
            "residual": None,
            "iteraciones": _recortar_iteraciones(iters_trap),
            "interpretacion": f"Distancia de frenado integrada con n={n} subintervalos (error O(h^2)).",
        },
        {
            "id": "simpson",
            "familia": "Integración",
            "nombre": "Simpson 1/3 compuesto",
            "tolerancia": None,
            "paso": t_det / n,
            "max_iter": n,
            "convergio": True,
            "tiempo_ms": ms_simp,
            "criterio_parada": f"n = {n} subintervalos",
            "resultado": I_simp,
            "referencia": d_fren,
            "error_abs": e_sp_abs,
            "error_rel": e_sp_rel,
            "error_pct": e_sp_pct,
            "residual": None,
            "iteraciones": _recortar_iteraciones(iters_simp),
            "interpretacion": f"Distancia de frenado integrada con n={n} subintervalos (error O(h^4)).",
        },
        {
            "id": "romberg",
            "familia": "Integración",
            "nombre": "Romberg",
            "tolerancia": tol,
            "paso": None,
            "max_iter": 10,
            "convergio": romb_conv,
            "tiempo_ms": ms_romb,
            "criterio_parada": romb_crit,
            "resultado": I_romb,
            "referencia": d_fren,
            "error_abs": e_rm_abs,
            "error_rel": e_rm_rel,
            "error_pct": e_rm_pct,
            "residual": romb_rows[-1]["residual"],
            "iteraciones": _recortar_iteraciones(romb_rows),
            "interpretacion": f"Extrapolación de Richardson en {len(romb_rows)} niveles hasta precisión {e_rm_abs:.3e}.",
        },
        {
            "id": "biseccion",
            "familia": "Raíces",
            "nombre": "Bisección",
            "tolerancia": tol,
            "paso": None,
            "max_iter": max_iter,
            "convergio": conv_bis,
            "tiempo_ms": ms_bis,
            "criterio_parada": crit_bis,
            "resultado": t_bis,
            "referencia": t_det,
            "error_abs": eb_abs,
            "error_rel": eb_rel,
            "error_pct": eb_pct,
            "residual": abs(f_raiz(t_bis)),
            "iteraciones": _recortar_iteraciones(it_bis),
            "interpretacion": f"Convergencia garantizada por cambio de signo en {len(it_bis)} iteraciones (insensible a raíz múltiple).",
        },
        {
            "id": "newton",
            "familia": "Raíces",
            "nombre": "Newton-Raphson",
            "tolerancia": tol,
            "paso": None,
            "max_iter": max_iter,
            "convergio": conv_new,
            "tiempo_ms": ms_new,
            "criterio_parada": crit_new,
            "resultado": t_new,
            "referencia": t_det,
            "error_abs": en_abs,
            "error_rel": en_rel,
            "error_pct": en_pct,
            "residual": abs(f_raiz(t_new)),
            "iteraciones": _recortar_iteraciones(it_new),
            "interpretacion": f"Raíz en {len(it_new)} iteraciones; formulación='{formulacion}'.",
        },
        {
            "id": "secante",
            "familia": "Raíces",
            "nombre": "Secante",
            "tolerancia": tol,
            "paso": None,
            "max_iter": max_iter,
            "convergio": conv_sec,
            "tiempo_ms": ms_sec,
            "criterio_parada": crit_sec,
            "resultado": t_sec,
            "referencia": t_det,
            "error_abs": es_abs,
            "error_rel": es_rel,
            "error_pct": es_pct,
            "residual": abs(f_raiz(t_sec)),
            "iteraciones": _recortar_iteraciones(it_sec),
            "interpretacion": f"Aproximación sin derivada analítica en {len(it_sec)} iteraciones.",
        },
    ]

    avisos = list(AVISOS_GENERALES)
    if not cumple:
        avisos.append(f"ALERTA OPERATIVA: la distancia total ({d_total_num:.3f} m) excede la distancia disponible ({d_disp:.3f} m).")
    if formulacion == "doble":
        avisos.append("Mal condicionamiento de raíz: formulación doble produce f'(t*)=0 y degrada a convergencia lineal en Newton/Secante.")

    return {
        "modulo": 1,
        "escenario": escenario,
        "params": p,
        "metodos": metodos,
        "indicadores": {
            "t_det_ref": t_det,
            "d_fren_ref": d_fren,
            "d_total_ref": d_total_ref,
            "d_total_num": d_total_num,
            "t_total": t_total,
            "margen": margen,
            "cumple": cumple,
            "derivada_en_raiz": derivada_en_raiz,
            "orden_rk2": orden_rk2,
            "orden_rk4": orden_rk4,
        },
        "sensibilidad": sensibilidad,
        "series": series,
        "refinamiento": refinamiento,
        "romberg": romb_table,
        "avisos": avisos,
    }


# ===========================================================================
# --- MÓDULO 2: DETERIORO MECÁNICO Y MANTENIMIENTO --------------------------
# ===========================================================================

def _construir_sistema_m2(sistema: str) -> list[list[float]]:
    if sistema == "base":
        return [
            [10.0, -1.0, 2.0, 0.0],
            [-1.0, 11.0, -1.0, 3.0],
            [2.0, -1.0, 10.0, -1.0],
            [0.0, 3.0, -1.0, 8.0],
        ]
    return [
        [1.0 / (i + j + 1) + (1e-4 if i == j else 0.0) for j in range(4)]
        for i in range(4)
    ]


def _mat_vec(A: list[list[float]], x: list[float]) -> list[float]:
    return [sum(A[i][j] * x[j] for j in range(len(x))) for i in range(len(A))]


def _gaussian_elimination_pp(A: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        M[col], M[piv] = M[piv], M[col]
        if abs(M[col][col]) < 1e-15:
            raise ValueError("Matriz singular en eliminación gaussiana.")
        for r in range(col + 1, n):
            fac = M[r][col] / M[col][col]
            for c in range(col, n + 1):
                M[r][c] -= fac * M[col][c]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        s = sum(M[i][j] * x[j] for j in range(i + 1, n))
        x[i] = (M[i][n] - s) / M[i][i]
    return x


def _lu_doolittle(A: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    L = [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
    U = [row[:] for row in A]
    for i in range(n):
        for j in range(i + 1, n):
            fac = U[j][i] / U[i][i]
            L[j][i] = fac
            for k in range(i, n):
                U[j][k] -= fac * U[i][k]
    y = [0.0] * n
    for i in range(n):
        y[i] = b[i] - sum(L[i][j] * y[j] for j in range(i))
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (y[i] - sum(U[i][j] * x[j] for j in range(i + 1, n))) / U[i][i]
    return x


def _residual_inf(A: list[list[float]], x: list[float], b: list[float]) -> float:
    ax = _mat_vec(A, x)
    return max(abs(ax[i] - b[i]) for i in range(len(b)))


def _jacobi_sl(A: list[list[float]], b: list[float], x_ref: list[float], tol: float, max_iter: int):
    t0 = time.perf_counter()
    n = len(b)
    x = [0.0] * n
    iters: list[dict[str, Any]] = []
    convergio = False
    criterio = f"máximo de {max_iter} iteraciones alcanzado"
    for k in range(1, max_iter + 1):
        x_new = [0.0] * n
        for i in range(n):
            s = sum(A[i][j] * x[j] for j in range(n) if j != i)
            x_new[i] = (b[i] - s) / A[i][i]
        if not all(math.isfinite(v) for v in x_new) or _norm_inf(x_new) > 1e10:
            res_val = float("nan")
            iters.append({"n": k, "aprox": x_new, "residual": None, "error_abs": None, "error_rel": None})
            x = x_new
            convergio = False
            criterio = "divergencia detectada"
            break
        res = _residual_inf(A, x_new, b)
        ea, er, _ = _calcular_errores(x_new, x_ref)
        iters.append({"n": k, "aprox": x_new[:], "residual": res, "error_abs": ea, "error_rel": er})
        step_diff = _norm_inf([x_new[i] - x[i] for i in range(n)])
        x = x_new
        if step_diff < tol:
            convergio = True
            criterio = f"||x_k - x_(k-1)||∞ < {tol}"
            break
    ms = (time.perf_counter() - t0) * 1000.0
    return x, iters, convergio, criterio, ms


def _gauss_seidel_sl(A: list[list[float]], b: list[float], x_ref: list[float], tol: float, max_iter: int):
    t0 = time.perf_counter()
    n = len(b)
    x = [0.0] * n
    iters: list[dict[str, Any]] = []
    convergio = False
    criterio = f"máximo de {max_iter} iteraciones alcanzado"
    for k in range(1, max_iter + 1):
        x_old = x[:]
        for i in range(n):
            s1 = sum(A[i][j] * x[j] for j in range(i))
            s2 = sum(A[i][j] * x_old[j] for j in range(i + 1, n))
            x[i] = (b[i] - s1 - s2) / A[i][i]
        if not all(math.isfinite(v) for v in x) or _norm_inf(x) > 1e10:
            iters.append({"n": k, "aprox": x[:], "residual": None, "error_abs": None, "error_rel": None})
            convergio = False
            criterio = "divergencia detectada"
            break
        res = _residual_inf(A, x, b)
        ea, er, _ = _calcular_errores(x, x_ref)
        iters.append({"n": k, "aprox": x[:], "residual": res, "error_abs": ea, "error_rel": er})
        step_diff = _norm_inf([x[i] - x_old[i] for i in range(n)])
        if step_diff < tol:
            convergio = True
            criterio = f"||x_k - x_(k-1)||∞ < {tol}"
            break
    ms = (time.perf_counter() - t0) * 1000.0
    return x, iters, convergio, criterio, ms


def _cg_sl(A: list[list[float]], b: list[float], x_ref: list[float], tol: float, max_iter: int):
    t0 = time.perf_counter()
    n = len(b)
    x = [0.0] * n
    r = b[:]
    p = r[:]
    rs_old = sum(v * v for v in r)
    iters: list[dict[str, Any]] = []
    convergio = False
    criterio = f"máximo de {max_iter} iteraciones alcanzado"
    if math.sqrt(rs_old) < tol:
        convergio = True
        criterio = f"||r||2 < {tol}"
        ea, er, _ = _calcular_errores(x, x_ref)
        iters.append({"n": 1, "aprox": x[:], "residual": _residual_inf(A, x, b), "error_abs": ea, "error_rel": er})
    else:
        for k in range(1, max_iter + 1):
            Ap = _mat_vec(A, p)
            denom = sum(p[i] * Ap[i] for i in range(n))
            if abs(denom) < 1e-30:
                criterio = "denominador nulo en gradiente conjugado"
                break
            alpha = rs_old / denom
            x = [x[i] + alpha * p[i] for i in range(n)]
            r = [r[i] - alpha * Ap[i] for i in range(n)]
            if not all(math.isfinite(v) for v in x) or _norm_inf(x) > 1e10:
                iters.append({"n": k, "aprox": x[:], "residual": None, "error_abs": None, "error_rel": None})
                criterio = "divergencia detectada"
                break
            rs_new = sum(v * v for v in r)
            res = _residual_inf(A, x, b)
            ea, er, _ = _calcular_errores(x, x_ref)
            iters.append({"n": k, "aprox": x[:], "residual": res, "error_abs": ea, "error_rel": er})
            if math.sqrt(rs_new) < tol:
                convergio = True
                criterio = f"||r||2 < {tol}"
                break
            beta = rs_new / rs_old
            p = [r[i] + beta * p[i] for i in range(n)]
            rs_old = rs_new
    ms = (time.perf_counter() - t0) * 1000.0
    return x, iters, convergio, criterio, ms


def _ejecutar_m2(escenario: str, p: dict[str, Any]) -> dict[str, Any]:
    sistema = str(p["sistema"])
    delta_b = float(p["delta_b"])
    tol_sl = float(p["tol_sl"])
    max_iter_sl = int(p["max_iter_sl"])
    D0 = float(p["D0"])
    alpha = float(p["alpha"])
    beta = float(p["beta"])
    d_umbral = float(p["d_umbral"])
    retraso = float(p["retraso"])
    tol_raiz = float(p["tol_raiz"])
    max_iter_raiz = int(p["max_iter_raiz"])

    A = _construir_sistema_m2(sistema)
    x_star = [1.0, 2.0, -1.0, 1.0]
    b0 = _mat_vec(A, x_star)
    perturb_vec = [delta_b * s for s in (1.0, -1.0, 1.0, -1.0)]
    b = [b0[i] + perturb_vec[i] for i in range(4)]

    # Solución directa de referencia
    t0_dir = time.perf_counter()
    x_ref = _gaussian_elimination_pp(A, b)
    ms_dir = (time.perf_counter() - t0_dir) * 1000.0
    res_dir = _residual_inf(A, x_ref, b)

    # LU
    t0_lu = time.perf_counter()
    x_lu = _lu_doolittle(A, b)
    ms_lu = (time.perf_counter() - t0_lu) * 1000.0
    res_lu = _residual_inf(A, x_lu, b)
    ea_lu, er_lu, ep_lu = _calcular_errores(x_lu, x_ref)

    # Iterativos
    x_jac, it_jac, conv_jac, crit_jac, ms_jac = _jacobi_sl(A, b, x_ref, tol_sl, max_iter_sl)
    x_gs, it_gs, conv_gs, crit_gs, ms_gs = _gauss_seidel_sl(A, b, x_ref, tol_sl, max_iter_sl)
    x_cg, it_cg, conv_cg, crit_cg, ms_cg = _cg_sl(A, b, x_ref, tol_sl, max_iter_sl)

    ea_jac, er_jac, ep_jac = _calcular_errores(x_jac, x_ref) if conv_jac or all(math.isfinite(v) for v in x_jac) else (None, None, None)
    res_jac = it_jac[-1]["residual"] if it_jac else None
    ea_gs, er_gs, ep_gs = _calcular_errores(x_gs, x_ref) if conv_gs or all(math.isfinite(v) for v in x_gs) else (None, None, None)
    res_gs = it_gs[-1]["residual"] if it_gs else None
    ea_cg, er_cg, ep_cg = _calcular_errores(x_cg, x_ref)
    res_cg = it_cg[-1]["residual"] if it_cg else None

    # Autovalores, condición y radio espectral de Jacobi
    A_np = np.array(A, dtype=float)
    eigs_A = np.linalg.eigvalsh(A_np)
    lambda_min = float(np.min(eigs_A))
    lambda_max = float(np.max(eigs_A))
    spd = lambda_min > 0.0
    kappa2 = float(lambda_max / lambda_min) if spd else None

    d_inv_sqrt = np.diag([1.0 / math.sqrt(A[i][i]) for i in range(4)])
    B_sym = np.eye(4) - d_inv_sqrt @ A_np @ d_inv_sqrt
    eigs_TJ = np.linalg.eigvalsh(B_sym)
    rho_jacobi = float(np.max(np.abs(eigs_TJ)))

    diag_dominante = all(abs(A[i][i]) > sum(abs(A[i][j]) for j in range(4) if j != i) for i in range(4))

    norm_b0 = _norm_2(b0)
    norm_db = _norm_2(perturb_vec)
    rel_db2 = norm_db / norm_b0 if norm_b0 > 1e-14 else 0.0
    rel_dx2 = _norm_2([x_ref[i] - x_star[i] for i in range(4)]) / _norm_2(x_star)
    amplificacion = (rel_dx2 / rel_db2) if (delta_b > 0.0 and rel_db2 > 1e-14) else None
    cota = (kappa2 * rel_db2) if kappa2 is not None else None

    # Raíces D(t) - d_umbral = 0
    t_star = _raiz_cuadratica_m2(D0, alpha, beta, d_umbral)

    def f_det(t: float) -> float:
        return D0 + alpha * t + beta * t * t - d_umbral

    def df_det(t: float) -> float:
        return alpha + 2.0 * beta * t

    if beta < 0.0:
        U = -alpha / (2.0 * beta)
    else:
        U = 1.0
        for _ in range(60):
            if f_det(U) > 0.0:
                break
            U *= 2.0

    t_bis, it_bis, conv_bis, crit_bis, ms_bis = _resolver_raiz_biseccion(f_det, 0.0, U, tol_raiz, max_iter_raiz, t_star)
    t_new, it_new, conv_new, crit_new, ms_new = _resolver_raiz_newton(f_det, df_det, 0.0, tol_raiz, max_iter_raiz, t_star)
    t_sec, it_sec, conv_sec, crit_sec, ms_sec = _resolver_raiz_secante(f_det, 0.0, U / 2.0, tol_raiz, max_iter_raiz, t_star)

    eb_abs, eb_rel, eb_pct = _calcular_errores(t_bis, t_star)
    en_abs, en_rel, en_pct = _calcular_errores(t_new, t_star)
    es_abs, es_rel, es_pct = _calcular_errores(t_sec, t_star)

    derivada_en_raiz = abs(df_det(t_star)) if t_star is not None else 0.0
    cond_raiz = (abs(d_umbral) / (abs(t_star) * derivada_en_raiz)) if (t_star and derivada_en_raiz > 1e-14) else None
    D_retraso = D0 + alpha * (t_star + retraso) + beta * (t_star + retraso) ** 2 if t_star is not None else None
    exceso = (D_retraso - d_umbral) if D_retraso is not None else None

    # Sensibilidad de t_star (+1%)
    sensibilidad: list[dict[str, Any]] = []
    for pname, pval in (("D0", D0), ("alpha", alpha), ("beta", beta), ("d_umbral", d_umbral)):
        if pval == 0.0:
            sensibilidad.append({
                "parametro": pname,
                "salida": "t_umbral_ref",
                "base": t_star,
                "perturbado": None,
                "S": None,
                "tipo": "relativa",
                "nota": "parámetro nulo",
            })
            continue
        kw = {"D0": D0, "alpha": alpha, "beta": beta, "d_umbral": d_umbral}
        kw[pname] = pval * 1.01
        t_p = _raiz_cuadratica_m2(kw["D0"], kw["alpha"], kw["beta"], kw["d_umbral"])
        if t_p is None or t_star is None or abs(t_star) <= 1e-14:
            sensibilidad.append({
                "parametro": pname,
                "salida": "t_umbral_ref",
                "base": t_star,
                "perturbado": None,
                "S": None,
                "tipo": "relativa",
                "nota": "sin raíz real tras la perturbación",
            })
        else:
            S_val = ((t_p - t_star) / t_star) / 0.01
            sensibilidad.append({
                "parametro": pname,
                "salida": "t_umbral_ref",
                "base": t_star,
                "perturbado": t_p,
                "S": S_val,
                "tipo": "relativa",
                "nota": None,
            })

    # Series D(t) en 100 puntos en [0, 1.5 * t_star]
    t_max_curva = 1.5 * (t_star if t_star else 10.0)
    curva_t = [t_max_curva * i / 99.0 for i in range(100)]
    curva_D = [D0 + alpha * ti + beta * ti * ti for ti in curva_t]

    metodos = [
        {
            "id": "directa",
            "familia": "Sistemas Lineales",
            "nombre": "Directa (Elim. Gaussiana PP)",
            "tolerancia": None,
            "paso": None,
            "max_iter": None,
            "convergio": True,
            "tiempo_ms": ms_dir,
            "criterio_parada": "eliminación gaussiana con pivoteo parcial",
            "resultado": x_ref,
            "referencia": x_ref,
            "error_abs": 0.0,
            "error_rel": 0.0,
            "error_pct": 0.0,
            "residual": res_dir,
            "iteraciones": [{"n": 1, "aprox": x_ref, "residual": res_dir, "error_abs": 0.0, "error_rel": 0.0}],
            "interpretacion": "Solución directa de referencia para la matriz SPD y vector b actuales.",
        },
        {
            "id": "lu",
            "familia": "Sistemas Lineales",
            "nombre": "Factorización LU (Doolittle)",
            "tolerancia": None,
            "paso": None,
            "max_iter": None,
            "convergio": True,
            "tiempo_ms": ms_lu,
            "criterio_parada": "factorización directa A = LU",
            "resultado": x_lu,
            "referencia": x_ref,
            "error_abs": ea_lu,
            "error_rel": er_lu,
            "error_pct": ep_lu,
            "residual": res_lu,
            "iteraciones": [{"n": 1, "aprox": x_lu, "residual": res_lu, "error_abs": ea_lu, "error_rel": er_lu}],
            "interpretacion": f"Resolución exacta en 1 factorización; error absoluto {ea_lu:.3e}.",
        },
        {
            "id": "jacobi",
            "familia": "Sistemas Lineales",
            "nombre": "Jacobi",
            "tolerancia": tol_sl,
            "paso": None,
            "max_iter": max_iter_sl,
            "convergio": conv_jac,
            "tiempo_ms": ms_jac,
            "criterio_parada": crit_jac,
            "resultado": x_jac,
            "referencia": x_ref,
            "error_abs": ea_jac,
            "error_rel": er_jac,
            "error_pct": ep_jac,
            "residual": res_jac,
            "iteraciones": _recortar_iteraciones(it_jac),
            "interpretacion": f"Iterativo estacionario simultáneo; ρ(T_J)={rho_jacobi:.4f} ({'converge' if conv_jac else 'no converge'}).",
        },
        {
            "id": "gauss_seidel",
            "familia": "Sistemas Lineales",
            "nombre": "Gauss-Seidel",
            "tolerancia": tol_sl,
            "paso": None,
            "max_iter": max_iter_sl,
            "convergio": conv_gs,
            "tiempo_ms": ms_gs,
            "criterio_parada": crit_gs,
            "resultado": x_gs,
            "referencia": x_ref,
            "error_abs": ea_gs,
            "error_rel": er_gs,
            "error_pct": ep_gs,
            "residual": res_gs,
            "iteraciones": _recortar_iteraciones(it_gs),
            "interpretacion": f"Iterativo secuencial; garantizado en SPD aunque lento si κ₂ es alto ({len(it_gs)} iteraciones).",
        },
        {
            "id": "gradiente_conjugado",
            "familia": "Sistemas Lineales",
            "nombre": "Gradiente Conjugado",
            "tolerancia": tol_sl,
            "paso": None,
            "max_iter": max_iter_sl,
            "convergio": conv_cg,
            "tiempo_ms": ms_cg,
            "criterio_parada": crit_cg,
            "resultado": x_cg,
            "referencia": x_ref,
            "error_abs": ea_cg,
            "error_rel": er_cg,
            "error_pct": ep_cg,
            "residual": res_cg,
            "iteraciones": _recortar_iteraciones(it_cg),
            "interpretacion": f"Óptimo para matrices SPD: converge en {len(it_cg)} iteraciones (n≤4 en aritmética exacta).",
        },
        {
            "id": "biseccion",
            "familia": "Raíces",
            "nombre": "Bisección",
            "tolerancia": tol_raiz,
            "paso": None,
            "max_iter": max_iter_raiz,
            "convergio": conv_bis,
            "tiempo_ms": ms_bis,
            "criterio_parada": crit_bis,
            "resultado": t_bis,
            "referencia": t_star,
            "error_abs": eb_abs,
            "error_rel": eb_rel,
            "error_pct": eb_pct,
            "residual": abs(f_det(t_bis)),
            "iteraciones": _recortar_iteraciones(it_bis),
            "interpretacion": f"Tiempo al umbral por bisección en [0, {U:.3g}] ({len(it_bis)} iteraciones).",
        },
        {
            "id": "newton",
            "familia": "Raíces",
            "nombre": "Newton-Raphson",
            "tolerancia": tol_raiz,
            "paso": None,
            "max_iter": max_iter_raiz,
            "convergio": conv_new,
            "tiempo_ms": ms_new,
            "criterio_parada": crit_new,
            "resultado": t_new,
            "referencia": t_star,
            "error_abs": en_abs,
            "error_rel": en_rel,
            "error_pct": en_pct,
            "residual": abs(f_det(t_new)),
            "iteraciones": _recortar_iteraciones(it_new),
            "interpretacion": f"Convergencia en {len(it_new)} iteraciones desde t₀=0.",
        },
        {
            "id": "secante",
            "familia": "Raíces",
            "nombre": "Secante",
            "tolerancia": tol_raiz,
            "paso": None,
            "max_iter": max_iter_raiz,
            "convergio": conv_sec,
            "tiempo_ms": ms_sec,
            "criterio_parada": crit_sec,
            "resultado": t_sec,
            "referencia": t_star,
            "error_abs": es_abs,
            "error_rel": es_rel,
            "error_pct": es_pct,
            "residual": abs(f_det(t_sec)),
            "iteraciones": _recortar_iteraciones(it_sec),
            "interpretacion": f"Secante en {len(it_sec)} iteraciones sin evaluar derivada explícita.",
        },
    ]

    avisos = list(AVISOS_GENERALES)
    if not conv_jac:
        avisos.append(f"Jacobi no converge porque ρ(T_J) = {rho_jacobi:.4f} >= 1 (fallo de convergencia del método estacionario).")
    if kappa2 is not None and kappa2 > 100.0:
        avisos.append(f"Matriz mal condicionada: κ₂(A) = {kappa2:.2f}; pequeñas perturbaciones en b se amplifican en x.")

    return {
        "modulo": 2,
        "escenario": escenario,
        "params": p,
        "metodos": metodos,
        "indicadores": {
            "lambda_min": lambda_min,
            "lambda_max": lambda_max,
            "kappa2": kappa2,
            "rho_jacobi": rho_jacobi,
            "diag_dominante": diag_dominante,
            "spd": spd,
            "rel_db2": rel_db2,
            "rel_dx2": rel_dx2,
            "amplificacion": amplificacion,
            "cota": cota,
            "x_star": x_star,
            "x_ref": x_ref,
            "t_umbral_ref": t_star,
            "derivada_en_raiz": derivada_en_raiz,
            "cond_raiz": cond_raiz,
            "D_retraso": D_retraso,
            "exceso": exceso,
        },
        "sensibilidad": sensibilidad,
        "series": {
            "t": curva_t,
            "D": curva_D,
            "umbral": [d_umbral] * 100,
            "t_star": t_star,
            "d_umbral": d_umbral,
        },
        "avisos": avisos,
    }


# ===========================================================================
# --- MÓDULO 3: OSCILACIONES POR VIENTO -------------------------------------
# ===========================================================================

def _m3_analitica_eval(m: float, c: float, k: float, x0: float, v0: float, t: float) -> tuple[float, float]:
    w0 = math.sqrt(k / m)
    zeta = c / (2.0 * math.sqrt(m * k))
    wd = w0 * math.sqrt(1.0 - zeta * zeta)
    sigma = zeta * w0
    env = math.exp(-sigma * t)
    cos_t = math.cos(wd * t)
    sin_t = math.sin(wd * t)
    C2_x = (v0 + sigma * x0) / wd
    C2_v = -(sigma * v0 + w0 * w0 * x0) / wd
    x = env * (x0 * cos_t + C2_x * sin_t)
    v = env * (v0 * cos_t + C2_v * sin_t)
    return x, v


def _m3_rk_step_euler_heun(m: float, c: float, k: float, F0: float, wf: float, t: float, x: float, v: float, h: float) -> tuple[float, float]:
    k1x = v
    k1v = (F0 * math.sin(wf * t) - c * v - k * x) / m
    xp = x + h * k1x
    vp = v + h * k1v
    k2x = vp
    k2v = (F0 * math.sin(wf * (t + h)) - c * vp - k * xp) / m
    return x + 0.5 * h * (k1x + k2x), v + 0.5 * h * (k1v + k2v)


def _m3_rk4_step(m: float, c: float, k: float, F0: float, wf: float, t: float, x: float, v: float, h: float) -> tuple[float, float]:
    half = 0.5 * h
    k1x = v
    k1v = (F0 * math.sin(wf * t) - c * v - k * x) / m

    t_mid = t + half
    f_mid = F0 * math.sin(wf * t_mid)
    x2 = x + half * k1x
    v2 = v + half * k1v
    k2x = v2
    k2v = (f_mid - c * v2 - k * x2) / m

    x3 = x + half * k2x
    v3 = v + half * k2v
    k3x = v3
    k3v = (f_mid - c * v3 - k * x3) / m

    x4 = x + h * k3x
    v4 = v + h * k3v
    k4x = v4
    k4v = (F0 * math.sin(wf * (t + h)) - c * v4 - k * x4) / m

    return (
        x + (h / 6.0) * (k1x + 2.0 * k2x + 2.0 * k3x + k4x),
        v + (h / 6.0) * (k1v + 2.0 * k2v + 2.0 * k3v + k4v),
    )


def _m3_integrar_edo(metodo: str, m: float, c: float, k: float, x0: float, v0: float, F0: float, wf: float, h: float, N: int):
    x, v = x0, v0
    xs = [x]
    vs = [v]
    for step in range(N):
        t = step * h
        if metodo == "rk2":
            x, v = _m3_rk_step_euler_heun(m, c, k, F0, wf, t, x, v, h)
        else:
            x, v = _m3_rk4_step(m, c, k, F0, wf, t, x, v, h)
        xs.append(x)
        vs.append(v)
    return xs, vs


def _m3_grid_energia(m: float, c: float, k: float, x0: float, v0: float, F0: float, wf: float, T: float, M: int = 4096) -> list[float]:
    zeta = c / (2.0 * math.sqrt(m * k))
    h_grid = T / M
    vals = [0.0] * (M + 1)
    if F0 == 0.0 and zeta < 1.0:
        for i in range(M + 1):
            xi, _ = _m3_analitica_eval(m, c, k, x0, v0, i * h_grid)
            vals[i] = xi * xi
    else:
        x, v = x0, v0
        vals[0] = x * x
        for i in range(M):
            x, v = _m3_rk4_step(m, c, k, F0, wf, i * h_grid, x, v, h_grid)
            vals[i + 1] = x * x
    return vals


def _m3_trap_grid(vals: list[float], T: float, n: int) -> float:
    M = len(vals) - 1
    stride = M // n
    h = T / n
    s = 0.5 * (vals[0] + vals[M])
    for i in range(1, n):
        s += vals[i * stride]
    return s * h


def _m3_simp_grid(vals: list[float], T: float, n: int) -> float:
    M = len(vals) - 1
    stride = M // n
    h = T / n
    s_imp = 0.0
    s_par = 0.0
    for i in range(1, n, 2):
        s_imp += vals[i * stride]
    for i in range(2, n, 2):
        s_par += vals[i * stride]
    return (h / 3.0) * (vals[0] + 4.0 * s_imp + 2.0 * s_par + vals[M])


def _m3_romberg_grid(vals: list[float], T: float, tol: float, max_niveles: int = 10):
    t0_cpu = time.perf_counter()
    R: list[list[float]] = []
    diag_rows: list[dict[str, Any]] = []
    convergio = False
    criterio = f"máximo de {max_niveles} niveles alcanzado"
    for k in range(max_niveles):
        n_int = 1 << k
        row = [0.0] * (k + 1)
        row[0] = _m3_trap_grid(vals, T, n_int)
        if k > 0:
            pow4 = 4.0
            for j in range(1, k + 1):
                row[j] = row[j - 1] + (row[j - 1] - R[k - 1][j - 1]) / (pow4 - 1.0)
                pow4 *= 4.0
        R.append(row)
        res = abs(row[k] - R[k - 1][k - 1]) if k > 0 else None
        diag_rows.append({"n": k + 1, "subintervalos": n_int, "aprox": row[k], "residual": res})
        if k > 0 and res is not None and res < tol:
            convergio = True
            criterio = f"|R[k,k]-R[k-1,k-1]| < {tol}"
            break
    ms = (time.perf_counter() - t0_cpu) * 1000.0
    return R[-1][-1], diag_rows, R, convergio, criterio, ms


def _ejecutar_m3(escenario: str, p: dict[str, Any]) -> dict[str, Any]:
    m = float(p["m"])
    c = float(p["c"])
    k = float(p["k"])
    x0 = float(p["x0"])
    v0 = float(p["v0"])
    F0 = float(p["F0"])
    wf = float(p["wf"])
    T = float(p["T"])
    h = float(p["h"])
    n = int(p["n"])
    tol_r = float(p["tol_romberg"])

    N = int(round(T / h))
    omega0 = math.sqrt(k / m)
    zeta = c / (2.0 * math.sqrt(m * k))
    omegad = omega0 * math.sqrt(1.0 - zeta * zeta) if zeta < 1.0 else None
    h_omega0 = h * omega0

    # Referencia
    ref_x = [0.0] * (N + 1)
    ref_v = [0.0] * (N + 1)
    if F0 == 0.0 and zeta < 1.0:
        tipo_ref = "analítica"
        for i in range(N + 1):
            ref_x[i], ref_v[i] = _m3_analitica_eval(m, c, k, x0, v0, i * h)
    else:
        tipo_ref = "numérica (RK4, h/20)"
        h_fine = h / 20.0
        xf, vf = x0, v0
        ref_x[0], ref_v[0] = xf, vf
        t_fine = 0.0
        for i in range(N):
            for _ in range(20):
                xf, vf = _m3_rk4_step(m, c, k, F0, wf, t_fine, xf, vf, h_fine)
                t_fine += h_fine
            ref_x[i + 1], ref_v[i + 1] = xf, vf

    t0_2 = time.perf_counter()
    rk2_x, rk2_v = _m3_integrar_edo("rk2", m, c, k, x0, v0, F0, wf, h, N)
    ms_2 = (time.perf_counter() - t0_2) * 1000.0

    t0_4 = time.perf_counter()
    rk4_x, rk4_v = _m3_integrar_edo("rk4", m, c, k, x0, v0, F0, wf, h, N)
    ms_4 = (time.perf_counter() - t0_4) * 1000.0

    # Mitad de paso para orden observado (error final)
    rk2_xh, rk2_vh = _m3_integrar_edo("rk2", m, c, k, x0, v0, F0, wf, h / 2.0, N * 2)
    rk4_xh, rk4_vh = _m3_integrar_edo("rk4", m, c, k, x0, v0, F0, wf, h / 2.0, N * 2)

    ref_end = [ref_x[-1], ref_v[-1]]
    e2_end, er2_end, ep2_end = _calcular_errores([rk2_x[-1], rk2_v[-1]], ref_end)
    e4_end, er4_end, ep4_end = _calcular_errores([rk4_x[-1], rk4_v[-1]], ref_end)
    e2_h2, _, _ = _calcular_errores([rk2_xh[-1], rk2_vh[-1]], ref_end)
    e4_h2, _, _ = _calcular_errores([rk4_xh[-1], rk4_vh[-1]], ref_end)

    orden_rk2 = math.log2(e2_end / e2_h2) if (e2_end and e2_h2 and e2_end > 1e-13 and e2_h2 > 1e-13) else None
    orden_rk4 = math.log2(e4_end / e4_h2) if (e4_end and e4_h2 and e4_end > 1e-13 and e4_h2 > 1e-13) else None

    ts = [i * h for i in range(N + 1)]
    iters_rk2: list[dict[str, Any]] = []
    iters_rk4: list[dict[str, Any]] = []
    errs_rk2: list[float] = []
    errs_rk4: list[float] = []
    for i in range(N + 1):
        r_vec = [ref_x[i], ref_v[i]]
        ea2, er2, _ = _calcular_errores([rk2_x[i], rk2_v[i]], r_vec)
        ea4, er4, _ = _calcular_errores([rk4_x[i], rk4_v[i]], r_vec)
        errs_rk2.append(ea2 if ea2 is not None else 0.0)
        errs_rk4.append(ea4 if ea4 is not None else 0.0)
        iters_rk2.append({"n": i, "t": ts[i], "aprox": [rk2_x[i], rk2_v[i]], "residual": None, "error_abs": ea2, "error_rel": er2})
        iters_rk4.append({"n": i, "t": ts[i], "aprox": [rk4_x[i], rk4_v[i]], "residual": None, "error_abs": ea4, "error_rel": er4})

    err_max_rk2 = max(errs_rk2)
    err_max_rk4 = max(errs_rk4)
    amp_max_rk4 = max(abs(x) for x in rk4_x)
    amp_max_ref = max(abs(x) for x in ref_x)

    # Integral de energía E = int_0^T x^2 dt
    vals_e = _m3_grid_energia(m, c, k, x0, v0, F0, wf, T, 4096)
    E_ref = _m3_simp_grid(vals_e, T, 4096)

    ns_ref: list[int] = []
    cur_n = 2
    while cur_n <= n:
        ns_ref.append(cur_n)
        cur_n *= 2

    refinamiento: list[dict[str, Any]] = []
    iters_trap: list[dict[str, Any]] = []
    iters_simp: list[dict[str, Any]] = []

    t0_tr = time.perf_counter()
    for idx, nk in enumerate(ns_ref, start=1):
        vt = _m3_trap_grid(vals_e, T, nk)
        et_a, et_r, _ = _calcular_errores(vt, E_ref)
        iters_trap.append({"n": idx, "subintervalos": nk, "aprox": vt, "residual": None, "error_abs": et_a, "error_rel": et_r})
        refinamiento.append({"n": nk, "trapecio": vt, "err_trap": et_a, "simpson": 0.0, "err_simp": 0.0})
    ms_tr = (time.perf_counter() - t0_tr) * 1000.0

    t0_sp = time.perf_counter()
    for idx, nk in enumerate(ns_ref, start=1):
        vs_int = _m3_simp_grid(vals_e, T, nk)
        es_a, es_r, _ = _calcular_errores(vs_int, E_ref)
        iters_simp.append({"n": idx, "subintervalos": nk, "aprox": vs_int, "residual": None, "error_abs": es_a, "error_rel": es_r})
        refinamiento[idx - 1]["simpson"] = vs_int
        refinamiento[idx - 1]["err_simp"] = es_a
    ms_sp = (time.perf_counter() - t0_sp) * 1000.0

    E_trap = refinamiento[-1]["trapecio"]
    E_simp = refinamiento[-1]["simpson"]
    et_abs, et_rel, et_pct = _calcular_errores(E_trap, E_ref)
    es_abs, es_rel, es_pct = _calcular_errores(E_simp, E_ref)

    E_romb, romb_rows, romb_table, romb_conv, romb_crit, ms_romb = _m3_romberg_grid(vals_e, T, tol_r)
    for r in romb_rows:
        ea, er, _ = _calcular_errores(r["aprox"], E_ref)
        r["error_abs"] = ea
        r["error_rel"] = er
    er_abs, er_rel, er_pct = _calcular_errores(E_romb, E_ref)

    # Resonancia / estado estacionario
    if F0 > 0.0 and wf > 0.0:
        def _amp_ss(w_val: float) -> float:
            return F0 / math.sqrt((k - m * w_val * w_val) ** 2 + (c * w_val) ** 2)

        amp_estacionaria = _amp_ss(wf)
        factor_amplificacion = amp_estacionaria * k / F0
        s_plus = abs(_amp_ss(1.01 * wf) / amp_estacionaria - 1.0)
        s_minus = abs(_amp_ss(0.99 * wf) / amp_estacionaria - 1.0)
        S_omega = max(s_plus, s_minus) / 0.01
    else:
        amp_estacionaria = None
        factor_amplificacion = None
        S_omega = None

    # Sensibilidad (+1% en c, k, y F0/wf si > 0)
    sensibilidad: list[dict[str, Any]] = []
    sens_params = ["c", "k"]
    if F0 > 0.0:
        sens_params.append("F0")
    if wf > 0.0:
        sens_params.append("wf")
    for pname in sens_params:
        kw = {"m": m, "c": c, "k": k, "F0": F0, "wf": wf}
        pval = kw[pname]
        if pval == 0.0:
            sensibilidad.append({"parametro": pname, "salida": "amp_max_rk4", "base": amp_max_rk4, "perturbado": amp_max_rk4, "S": None, "tipo": "relativa", "nota": "parámetro nulo"})
            sensibilidad.append({"parametro": pname, "salida": "E_simpson", "base": E_simp, "perturbado": E_simp, "S": None, "tipo": "relativa", "nota": "parámetro nulo"})
            continue
        kw[pname] = pval * 1.01
        px, _ = _m3_integrar_edo("rk4", kw["m"], kw["c"], kw["k"], x0, v0, kw["F0"], kw["wf"], h, N)
        amp_p = max(abs(val) for val in px)
        s_amp = ((amp_p - amp_max_rk4) / amp_max_rk4) / 0.01 if abs(amp_max_rk4) > 1e-14 else None
        sensibilidad.append({"parametro": pname, "salida": "amp_max_rk4", "base": amp_max_rk4, "perturbado": amp_p, "S": s_amp, "tipo": "relativa", "nota": None})

        vals_p = _m3_grid_energia(kw["m"], kw["c"], kw["k"], x0, v0, kw["F0"], kw["wf"], T, 4096)
        e_p = _m3_simp_grid(vals_p, T, n)
        s_e = ((e_p - E_simp) / E_simp) / 0.01 if abs(E_simp) > 1e-14 else None
        sensibilidad.append({"parametro": pname, "salida": "E_simpson", "base": E_simp, "perturbado": e_p, "S": s_e, "tipo": "relativa", "nota": None})

    idx_s = _submuestrear_indices(len(ts), 1000)
    series = {
        "t": [ts[i] for i in idx_s],
        "rk2_x": [rk2_x[i] for i in idx_s],
        "rk4_x": [rk4_x[i] for i in idx_s],
        "ref_x": [ref_x[i] for i in idx_s],
        "err_rk2": [errs_rk2[i] for i in idx_s],
        "err_rk4": [errs_rk4[i] for i in idx_s],
    }

    metodos = [
        {
            "id": "rk2",
            "familia": "EDO",
            "nombre": "RK2 (Heun)",
            "tolerancia": None,
            "paso": h,
            "max_iter": None,
            "convergio": True,
            "tiempo_ms": ms_2,
            "criterio_parada": f"N = {N} pasos en [0, {T}] s",
            "resultado": [rk2_x[-1], rk2_v[-1]],
            "referencia": ref_end,
            "error_abs": e2_end,
            "error_rel": er2_end,
            "error_pct": ep2_end,
            "residual": None,
            "iteraciones": _recortar_iteraciones(iters_rk2, es_edo=True),
            "interpretacion": f"Oscilador con Heun (O(h^2)); error máximo en la trayectoria: {err_max_rk2:.3e}.",
        },
        {
            "id": "rk4",
            "familia": "EDO",
            "nombre": "RK4 (Clásico)",
            "tolerancia": None,
            "paso": h,
            "max_iter": None,
            "convergio": True,
            "tiempo_ms": ms_4,
            "criterio_parada": f"N = {N} pasos en [0, {T}] s",
            "resultado": [rk4_x[-1], rk4_v[-1]],
            "referencia": ref_end,
            "error_abs": e4_end,
            "error_rel": er4_end,
            "error_pct": ep4_end,
            "residual": None,
            "iteraciones": _recortar_iteraciones(iters_rk4, es_edo=True),
            "interpretacion": f"Oscilador con RK4 (O(h^4)); error máximo en la trayectoria: {err_max_rk4:.3e}.",
        },
        {
            "id": "trapecio",
            "familia": "Integración",
            "nombre": "Trapecio compuesto",
            "tolerancia": None,
            "paso": T / n,
            "max_iter": n,
            "convergio": True,
            "tiempo_ms": ms_tr,
            "criterio_parada": f"n = {n} subintervalos",
            "resultado": E_trap,
            "referencia": E_ref,
            "error_abs": et_abs,
            "error_rel": et_rel,
            "error_pct": et_pct,
            "residual": None,
            "iteraciones": _recortar_iteraciones(iters_trap),
            "interpretacion": f"Energía vibratoria ∫x²dt con Trapecio (n={n}).",
        },
        {
            "id": "simpson",
            "familia": "Integración",
            "nombre": "Simpson 1/3 compuesto",
            "tolerancia": None,
            "paso": T / n,
            "max_iter": n,
            "convergio": True,
            "tiempo_ms": ms_sp,
            "criterio_parada": f"n = {n} subintervalos",
            "resultado": E_simp,
            "referencia": E_ref,
            "error_abs": es_abs,
            "error_rel": es_rel,
            "error_pct": es_pct,
            "residual": None,
            "iteraciones": _recortar_iteraciones(iters_simp),
            "interpretacion": f"Energía vibratoria ∫x²dt con Simpson 1/3 (n={n}).",
        },
        {
            "id": "romberg",
            "familia": "Integración",
            "nombre": "Romberg",
            "tolerancia": tol_r,
            "paso": None,
            "max_iter": 10,
            "convergio": romb_conv,
            "tiempo_ms": ms_romb,
            "criterio_parada": romb_crit,
            "resultado": E_romb,
            "referencia": E_ref,
            "error_abs": er_abs,
            "error_rel": er_rel,
            "error_pct": er_pct,
            "residual": romb_rows[-1]["residual"],
            "iteraciones": _recortar_iteraciones(romb_rows),
            "interpretacion": f"Romberg en {len(romb_rows)} niveles (error {er_abs:.3e}).",
        },
    ]

    avisos = list(AVISOS_GENERALES)
    avisos.append("Nota numérica: RK2/Heun introduce amortiguamiento o amplificación numérica artificial en oscilaciones poco amortiguadas.")
    if h_omega0 > 2.78:
        avisos.append(f"ALERTA DE ESTABILIDAD: h·ω₀ = {h_omega0:.3f} > 2.78 (límite de estabilidad de RK4).")

    return {
        "modulo": 3,
        "escenario": escenario,
        "params": p,
        "metodos": metodos,
        "indicadores": {
            "omega0": omega0,
            "zeta": zeta,
            "omegad": omegad,
            "tipo_referencia": tipo_ref,
            "amp_max_rk4": amp_max_rk4,
            "amp_max_ref": amp_max_ref,
            "err_max_rk2": err_max_rk2,
            "err_max_rk4": err_max_rk4,
            "orden_rk2": orden_rk2,
            "orden_rk4": orden_rk4,
            "h_omega0": h_omega0,
            "amp_estacionaria": amp_estacionaria,
            "factor_amplificacion": factor_amplificacion,
            "S_omega": S_omega,
        },
        "sensibilidad": sensibilidad,
        "series": series,
        "refinamiento": refinamiento,
        "romberg": romb_table,
        "avisos": avisos,
    }


# ===========================================================================
# --- MÓDULO 4: RECONSTRUCCIÓN DE SEÑALES DE SENSORES -----------------------
# ===========================================================================

def _m4_y_ex(t: float) -> float:
    return 2.0 + math.exp(-0.2 * t) * math.sin(t)


def _m4_ruido(i: int, sigma: float) -> float:
    raw = abs(math.sin((i + 1) * 12.9898) * 43758.5453)
    frac = raw - math.floor(raw)
    return sigma * math.sqrt(3.0) * (2.0 * frac - 1.0)


def _m4_nodos(n: int, t_fin: float, distribucion: str, sigma: float) -> tuple[list[float], list[float]]:
    if distribucion == "chebyshev":
        t_nodos = [0.5 * t_fin * (1.0 - math.cos(math.pi * i / (n - 1))) for i in range(n)]
    else:
        t_nodos = [t_fin * i / (n - 1) for i in range(n)]
    y_nodos = [_m4_y_ex(t_nodos[i]) + _m4_ruido(i, sigma) for i in range(n)]
    return t_nodos, y_nodos


def _lagrange_eval(xn: list[float], yn: list[float], x: float) -> float:
    n = len(xn)
    y = 0.0
    for i in range(n):
        li = 1.0
        xi = xn[i]
        for j in range(n):
            if i != j:
                li *= (x - xn[j]) / (xi - xn[j])
        y += yn[i] * li
    return y


def _newton_dd_coefs(xn: list[float], yn: list[float]) -> list[float]:
    n = len(xn)
    dd = yn[:]
    for j in range(1, n):
        for i in range(n - 1, j - 1, -1):
            dd[i] = (dd[i] - dd[i - 1]) / (xn[i] - xn[i - j])
    return dd


def _newton_dd_eval(xn: list[float], coefs: list[float], x: float) -> float:
    n = len(coefs)
    val = coefs[n - 1]
    for i in range(n - 2, -1, -1):
        val = val * (x - xn[i]) + coefs[i]
    return val


def _spline_natural_params(xn: list[float], yn: list[float]):
    n = len(xn) - 1
    h = [xn[i + 1] - xn[i] for i in range(n)]
    c = [0.0] * (n + 1)
    if n >= 2:
        # Sistema tridiagonal (n-1) x (n-1) para c_1 .. c_{n-1} resuelto con Thomas
        m_size = n - 1
        a_sub = [0.0] * m_size
        b_diag = [0.0] * m_size
        c_sup = [0.0] * m_size
        rhs = [0.0] * m_size
        for i in range(1, n):
            idx = i - 1
            a_sub[idx] = h[i - 1]
            b_diag[idx] = 2.0 * (h[i - 1] + h[i])
            c_sup[idx] = h[i]
            rhs[idx] = 3.0 * ((yn[i + 1] - yn[i]) / h[i] - (yn[i] - yn[i - 1]) / h[i - 1])
        # Barrido hacia adelante de Thomas
        for idx in range(1, m_size):
            w = a_sub[idx] / b_diag[idx - 1]
            b_diag[idx] -= w * c_sup[idx - 1]
            rhs[idx] -= w * rhs[idx - 1]
        c[n - 1] = rhs[m_size - 1] / b_diag[m_size - 1]
        for idx in range(m_size - 2, -1, -1):
            c[idx + 1] = (rhs[idx] - c_sup[idx] * c[idx + 2]) / b_diag[idx]
    b_coef = [(yn[i + 1] - yn[i]) / h[i] - h[i] * (c[i + 1] + 2.0 * c[i]) / 3.0 for i in range(n)]
    d_coef = [(c[i + 1] - c[i]) / (3.0 * h[i]) for i in range(n)]
    return b_coef, c, d_coef


def _spline_natural_eval(xn: list[float], yn: list[float], b_coef: list[float], c: list[float], d_coef: list[float], x: float) -> float:
    n = len(xn) - 1
    seg = n - 1
    for i in range(n):
        if x <= xn[i + 1] or i == n - 1:
            seg = i
            break
    dx = x - xn[seg]
    return yn[seg] + b_coef[seg] * dx + c[seg] * dx * dx + d_coef[seg] * dx * dx * dx


def _rmse(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)) / len(a))


def _buscar_primer_cruce(f: Any, t_grid: list[float], y_umbral: float, tol: float):
    t0_cpu = time.perf_counter()
    vals = [f(t) - y_umbral for t in t_grid]
    lo = None
    hi = None
    for i in range(len(t_grid) - 1):
        if abs(vals[i]) == 0.0:
            t_hit = t_grid[i]
            return t_hit, [{"n": 1, "aprox": t_hit, "residual": 0.0, "error_abs": None, "error_rel": None, "a": t_hit, "b": t_hit}], True, "cruce exacto en nodo de malla", (time.perf_counter() - t0_cpu) * 1000.0
        if vals[i] * vals[i + 1] <= 0.0:
            lo, hi = t_grid[i], t_grid[i + 1]
            break
    if lo is None or hi is None:
        return None, [], False, "sin cruce del umbral", (time.perf_counter() - t0_cpu) * 1000.0

    flo = f(lo) - y_umbral
    c = lo
    iters: list[dict[str, Any]] = []
    for k in range(1, 101):
        c = 0.5 * (lo + hi)
        fc = f(c) - y_umbral
        iters.append({"n": k, "aprox": c, "residual": abs(fc), "error_abs": None, "error_rel": None, "a": lo, "b": hi})
        if abs(fc) < tol or 0.5 * (hi - lo) < tol:
            break
        if flo * fc <= 0.0:
            hi = c
        else:
            lo = c
            flo = fc
    ms = (time.perf_counter() - t0_cpu) * 1000.0
    return c, iters, True, f"bisección con tol={tol}", ms


def _m4_rmse_para_sigma(n_nodos: int, t_fin: float, dist: str, sigma: float) -> tuple[float, float]:
    tn, yn = _m4_nodos(n_nodos, t_fin, dist, sigma)
    t_eval = [t_fin * k / 200.0 for k in range(201)]
    y_ref = [_m4_y_ex(t) for t in t_eval]
    y_lag = [_lagrange_eval(tn, yn, t) for t in t_eval]
    bc, cc, dc = _spline_natural_params(tn, yn)
    y_spl = [_spline_natural_eval(tn, yn, bc, cc, dc, t) for t in t_eval]
    return _rmse(y_lag, y_ref), _rmse(y_spl, y_ref)


def _ejecutar_m4(escenario: str, p: dict[str, Any]) -> dict[str, Any]:
    n_nodos = int(p["n_nodos"])
    t_fin = float(p["t_fin"])
    dist = str(p["distribucion"])
    sigma = float(p["sigma"])
    y_umbral = float(p["y_umbral"])

    t_nodos, y_nodos = _m4_nodos(n_nodos, t_fin, dist, sigma)
    ocultos_t = [0.5 * (t_nodos[i] + t_nodos[i + 1]) for i in range(n_nodos - 1)]
    ocultos_y = [_m4_y_ex(t) for t in ocultos_t]
    max_oculto = max(abs(v) for v in ocultos_y)

    t_eval = [t_fin * k / 200.0 for k in range(201)]
    y_ref = [_m4_y_ex(t) for t in t_eval]

    # Lagrange
    t0_l = time.perf_counter()
    y_lag_dense = [_lagrange_eval(t_nodos, y_nodos, t) for t in t_eval]
    y_lag_oc = [_lagrange_eval(t_nodos, y_nodos, t) for t in ocultos_t]
    ms_l = (time.perf_counter() - t0_l) * 1000.0
    rmse_lag = _rmse(y_lag_dense, y_ref)
    ea_lag, er_lag, ep_lag = _calcular_errores(y_lag_oc, ocultos_y)
    it_lag = [
        {
            "n": i + 1,
            "t": ocultos_t[i],
            "aprox": y_lag_oc[i],
            "residual": None,
            "error_abs": abs(y_lag_oc[i] - ocultos_y[i]),
            "error_rel": abs(y_lag_oc[i] - ocultos_y[i]) / max_oculto if max_oculto > 1e-12 else None,
        }
        for i in range(len(ocultos_t))
    ]

    # Newton diferencias divididas
    t0_n = time.perf_counter()
    coefs_dd = _newton_dd_coefs(t_nodos, y_nodos)
    y_new_dense = [_newton_dd_eval(t_nodos, coefs_dd, t) for t in t_eval]
    y_new_oc = [_newton_dd_eval(t_nodos, coefs_dd, t) for t in ocultos_t]
    ms_n = (time.perf_counter() - t0_n) * 1000.0
    rmse_new = _rmse(y_new_dense, y_ref)
    ea_new, er_new, ep_new = _calcular_errores(y_new_oc, ocultos_y)
    it_new = [
        {
            "n": i + 1,
            "t": ocultos_t[i],
            "aprox": y_new_oc[i],
            "residual": None,
            "error_abs": abs(y_new_oc[i] - ocultos_y[i]),
            "error_rel": abs(y_new_oc[i] - ocultos_y[i]) / max_oculto if max_oculto > 1e-12 else None,
        }
        for i in range(len(ocultos_t))
    ]

    # Spline cúbico natural
    t0_s = time.perf_counter()
    b_coef, c_coef, d_coef = _spline_natural_params(t_nodos, y_nodos)
    y_spl_dense = [_spline_natural_eval(t_nodos, y_nodos, b_coef, c_coef, d_coef, t) for t in t_eval]
    y_spl_oc = [_spline_natural_eval(t_nodos, y_nodos, b_coef, c_coef, d_coef, t) for t in ocultos_t]
    ms_s = (time.perf_counter() - t0_s) * 1000.0
    rmse_spl = _rmse(y_spl_dense, y_ref)
    ea_spl, er_spl, ep_spl = _calcular_errores(y_spl_oc, ocultos_y)
    it_spl = [
        {
            "n": i + 1,
            "t": ocultos_t[i],
            "aprox": y_spl_oc[i],
            "residual": None,
            "error_abs": abs(y_spl_oc[i] - ocultos_y[i]),
            "error_rel": abs(y_spl_oc[i] - ocultos_y[i]) / max_oculto if max_oculto > 1e-12 else None,
        }
        for i in range(len(ocultos_t))
    ]

    # Bisección de cruce sobre spline natural vs referencia y_ex
    t_cruce_ref, _, conv_ref, _, _ = _buscar_primer_cruce(_m4_y_ex, t_eval, y_umbral, 1e-13)
    t_cruce, it_cruce, conv_cruce, crit_cruce, ms_cruce = _buscar_primer_cruce(
        lambda t: _spline_natural_eval(t_nodos, y_nodos, b_coef, c_coef, d_coef, t),
        t_eval,
        y_umbral,
        1e-10,
    )
    if conv_cruce and t_cruce_ref is not None and t_cruce is not None:
        for row in it_cruce:
            ea, er, _ = _calcular_errores(row["aprox"], t_cruce_ref)
            row["error_abs"] = ea
            row["error_rel"] = er
        ec_abs, ec_rel, ec_pct = _calcular_errores(t_cruce, t_cruce_ref)
    else:
        ec_abs, ec_rel, ec_pct = None, None, None

    # Constante de Lebesgue sobre 1001 puntos
    lebesgue = 0.0
    for k in range(1001):
        tk = t_fin * k / 1000.0
        s_abs = 0.0
        for i in range(n_nodos):
            li = 1.0
            xi = t_nodos[i]
            for j in range(n_nodos):
                if i != j:
                    li *= (tk - t_nodos[j]) / (xi - t_nodos[j])
            s_abs += abs(li)
        if s_abs > lebesgue:
            lebesgue = s_abs

    max_dif_lag_newton = max(abs(a - b) for a, b in zip(y_lag_dense, y_new_dense))

    # Sensibilidad ΔRMSE/Δσ con σ + 0.01
    rmse_lag_p, rmse_spl_p = _m4_rmse_para_sigma(n_nodos, t_fin, dist, sigma + 0.01)
    sensibilidad = [
        {
            "parametro": "sigma",
            "salida": "rmse_lag",
            "base": rmse_lag,
            "perturbado": rmse_lag_p,
            "S": (rmse_lag_p - rmse_lag) / 0.01,
            "tipo": "absoluta",
            "nota": None,
        },
        {
            "parametro": "sigma",
            "salida": "rmse_spl",
            "base": rmse_spl,
            "perturbado": rmse_spl_p,
            "S": (rmse_spl_p - rmse_spl) / 0.01,
            "tipo": "absoluta",
            "nota": None,
        },
    ]

    err_lag = [abs(a - b) for a, b in zip(y_lag_dense, y_ref)]
    err_new = [abs(a - b) for a, b in zip(y_new_dense, y_ref)]
    err_spl = [abs(a - b) for a, b in zip(y_spl_dense, y_ref)]

    res_cruce = (
        abs(_spline_natural_eval(t_nodos, y_nodos, b_coef, c_coef, d_coef, t_cruce) - y_umbral)
        if (conv_cruce and t_cruce is not None)
        else None
    )

    metodos = [
        {
            "id": "lagrange",
            "familia": "Interpolación",
            "nombre": "Lagrange",
            "tolerancia": None,
            "paso": None,
            "max_iter": None,
            "convergio": True,
            "tiempo_ms": ms_l,
            "criterio_parada": f"polinomio único de grado {n_nodos - 1}",
            "resultado": y_lag_oc,
            "referencia": ocultos_y,
            "error_abs": ea_lag,
            "error_rel": er_lag,
            "error_pct": ep_lag,
            "residual": rmse_lag,
            "iteraciones": _recortar_iteraciones(it_lag),
            "interpretacion": f"Error máximo en puntos ocultados: {ea_lag:.3e}; RMSE global: {rmse_lag:.3e}.",
        },
        {
            "id": "newton_dd",
            "familia": "Interpolación",
            "nombre": "Newton (Dif. Divididas)",
            "tolerancia": None,
            "paso": None,
            "max_iter": None,
            "convergio": True,
            "tiempo_ms": ms_n,
            "criterio_parada": f"polinomio único de grado {n_nodos - 1}",
            "resultado": y_new_oc,
            "referencia": ocultos_y,
            "error_abs": ea_new,
            "error_rel": er_new,
            "error_pct": ep_new,
            "residual": rmse_new,
            "iteraciones": _recortar_iteraciones(it_new),
            "interpretacion": f"Matemáticamente idéntico a Lagrange (dif. máx. {max_dif_lag_newton:.2e}); RMSE: {rmse_new:.3e}.",
        },
        {
            "id": "spline_natural",
            "familia": "Interpolación",
            "nombre": "Splines Cúbicos Naturales",
            "tolerancia": None,
            "paso": None,
            "max_iter": None,
            "convergio": True,
            "tiempo_ms": ms_s,
            "criterio_parada": "sistema tridiagonal (Thomas)",
            "resultado": y_spl_oc,
            "referencia": ocultos_y,
            "error_abs": ea_spl,
            "error_rel": er_spl,
            "error_pct": ep_spl,
            "residual": rmse_spl,
            "iteraciones": _recortar_iteraciones(it_spl),
            "interpretacion": f"Interpolación cúbica por tramos sin oscilación de Runge; RMSE: {rmse_spl:.3e}.",
        },
        {
            "id": "biseccion_cruce",
            "familia": "Raíces",
            "nombre": "Bisección (Cruce de Umbral)",
            "tolerancia": 1e-10,
            "paso": None,
            "max_iter": 100,
            "convergio": conv_cruce,
            "tiempo_ms": ms_cruce,
            "criterio_parada": crit_cruce,
            "resultado": t_cruce,
            "referencia": t_cruce_ref if conv_ref else None,
            "error_abs": ec_abs,
            "error_rel": ec_rel,
            "error_pct": ec_pct,
            "residual": res_cruce,
            "iteraciones": _recortar_iteraciones(it_cruce),
            "interpretacion": (
                f"Primer cruce con y={y_umbral} en t={t_cruce:.5f} s."
                if conv_cruce and t_cruce is not None
                else f"No se detectó cruce con el umbral y={y_umbral}."
            ),
        },
    ]

    avisos = list(AVISOS_GENERALES)
    if lebesgue > 100.0:
        avisos.append(f"Fenómeno de Runge severo: constante de Lebesgue Λ = {lebesgue:.2f} amplifica errores y ruido en nodos equiespaciados.")

    return {
        "modulo": 4,
        "escenario": escenario,
        "params": p,
        "metodos": metodos,
        "indicadores": {
            "lebesgue": lebesgue,
            "rmse_lag": rmse_lag,
            "rmse_new": rmse_new,
            "rmse_spl": rmse_spl,
            "max_dif_lag_newton": max_dif_lag_newton,
            "newton_coefs": coefs_dd,
        },
        "sensibilidad": sensibilidad,
        "series": {
            "t": t_eval,
            "ref": y_ref,
            "lag": y_lag_dense,
            "newton": y_new_dense,
            "spline": y_spl_dense,
            "nodos_t": t_nodos,
            "nodos_y": y_nodos,
            "ocultos_t": ocultos_t,
            "ocultos_y": ocultos_y,
            "err_lag": err_lag,
            "err_new": err_new,
            "err_spl": err_spl,
        },
        "avisos": avisos,
    }


def _limpiar_json(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _limpiar_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_limpiar_json(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        val = float(obj)
        return val if math.isfinite(val) else None
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    return obj


def ejecutar(modulo: int | str, escenario: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Valida y ejecuta el módulo numérico indicado."""
    try:
        mod = int(modulo)
    except (TypeError, ValueError) as exc:
        raise ValueError("Módulo inválido.") from exc
    if mod not in PRESETS:
        raise ValueError("Módulo inválido.")
    if escenario not in PRESETS[mod]:
        raise ValueError("Escenario inválido (NORMAL, ESTRES o MAL_CONDICIONADO).")

    p = _coercer_params(mod, escenario, params)
    errores = validar(mod, p)
    if errores:
        raise ValueError("; ".join(errores))

    if mod == 1:
        res = _ejecutar_m1(escenario, p)
    elif mod == 2:
        res = _ejecutar_m2(escenario, p)
    elif mod == 3:
        res = _ejecutar_m3(escenario, p)
    else:
        res = _ejecutar_m4(escenario, p)

    return _limpiar_json(res)
