"""Pruebas matemáticas del motor numérico SIMTELE-RISK."""

import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import motor_numerico as mn


def by_id(res):
    return {m["id"]: m for m in res["metodos"]}


def run_all():
    # 1. Ejecutar los 12 presets sin excepciones
    resultados = {}
    for mod in (1, 2, 3, 4):
        resultados[mod] = {}
        for esc in ("NORMAL", "ESTRES", "MAL_CONDICIONADO"):
            r = mn.ejecutar(mod, esc)
            resultados[mod][esc] = r
            assert r["modulo"] == mod
            assert r["escenario"] == esc
            assert len(r["metodos"]) > 0

    # --- M1 ---
    r1_n = resultados[1]["NORMAL"]
    m1_n = by_id(r1_n)
    assert m1_n["simpson"]["error_abs"] < 1e-6, m1_n["simpson"]
    assert m1_n["rk4"]["error_abs"] < 1e-6, m1_n["rk4"]
    assert m1_n["rk4"]["error_abs"] < m1_n["rk2"]["error_abs"]
    assert m1_n["romberg"]["error_abs"] < 1e-7
    for rid in ("biseccion", "newton", "secante"):
        assert m1_n[rid]["convergio"] is True, rid
        assert m1_n[rid]["error_abs"] < 1e-6, rid

    r1_m = resultados[1]["MAL_CONDICIONADO"]
    m1_m = by_id(r1_m)
    assert m1_m["biseccion"]["convergio"] is True
    assert r1_m["indicadores"]["derivada_en_raiz"] < 1e-10
    assert len(m1_m["newton"]["iteraciones"]) > len(m1_n["newton"]["iteraciones"])

    r1_e = resultados[1]["ESTRES"]
    assert r1_e["indicadores"]["cumple"] is False

    # --- M2 ---
    r2_n = resultados[2]["NORMAL"]
    m2_n = by_id(r2_n)
    for lid in ("jacobi", "gauss_seidel", "gradiente_conjugado", "lu"):
        assert m2_n[lid]["convergio"] is True, lid
        assert m2_n[lid]["error_abs"] < 1e-5, lid
    assert r2_n["indicadores"]["rho_jacobi"] < 1.0
    for rid in ("biseccion", "newton", "secante"):
        assert m2_n[rid]["convergio"] is True
        assert m2_n[rid]["error_abs"] < 1e-6

    r2_e = resultados[2]["ESTRES"]
    m2_e = by_id(r2_e)
    assert r2_e["indicadores"]["rel_dx2"] <= r2_e["indicadores"]["cota"] * (1.0 + 1e-9)
    assert r2_e["indicadores"]["amplificacion"] <= r2_e["indicadores"]["kappa2"] * (1.0 + 1e-9)
    for rid in ("biseccion", "newton", "secante"):
        assert m2_e[rid]["convergio"] is True
        assert m2_e[rid]["error_abs"] < 1e-6

    r2_m = resultados[2]["MAL_CONDICIONADO"]
    m2_m = by_id(r2_m)
    assert r2_m["indicadores"]["kappa2"] > 1e3
    assert r2_m["indicadores"]["rho_jacobi"] > 1.0
    assert m2_m["jacobi"]["convergio"] is False
    assert m2_m["gauss_seidel"]["convergio"] is False
    assert m2_m["gauss_seidel"]["residual"] < 1e-5
    assert m2_m["gauss_seidel"]["error_abs"] > 100.0 * m2_m["gauss_seidel"]["residual"]
    assert m2_m["gradiente_conjugado"]["residual"] < 1e-6
    assert abs(r2_m["indicadores"]["t_umbral_ref"] - 7.98586) < 1e-4

    # --- M3 ---
    r3_n = resultados[3]["NORMAL"]
    m3_n = by_id(r3_n)
    assert r3_n["indicadores"]["tipo_referencia"] == "analítica"
    assert m3_n["rk4"]["error_abs"] < m3_n["rk2"]["error_abs"]
    assert m3_n["rk4"]["error_abs"] < 1e-4
    assert m3_n["simpson"]["error_abs"] < m3_n["trapecio"]["error_abs"]

    r3_e = resultados[3]["ESTRES"]
    assert r3_e["indicadores"]["tipo_referencia"] == "numérica (RK4, h/20)"
    r3_m = resultados[3]["MAL_CONDICIONADO"]
    assert r3_m["indicadores"]["tipo_referencia"] == "numérica (RK4, h/20)"
    assert r3_m["indicadores"]["factor_amplificacion"] > 50.0

    # --- M4 ---
    for esc in ("NORMAL", "ESTRES", "MAL_CONDICIONADO"):
        assert resultados[4][esc]["indicadores"]["max_dif_lag_newton"] < 1e-8

    r4_n = resultados[4]["NORMAL"]
    assert r4_n["indicadores"]["rmse_spl"] < 0.05
    m4_n = by_id(r4_n)
    assert m4_n["biseccion_cruce"]["convergio"] is True

    r4_m = resultados[4]["MAL_CONDICIONADO"]
    assert r4_m["indicadores"]["lebesgue"] > 100.0
    r4_cheb = mn.ejecutar(4, "MAL_CONDICIONADO", {"distribucion": "chebyshev"})
    assert r4_cheb["indicadores"]["lebesgue"] < r4_m["indicadores"]["lebesgue"]
    assert r4_cheb["indicadores"]["lebesgue"] < 10.0

    # Validación negativa básica
    assert len(mn.validar(1, {**mn.PRESETS[1]["NORMAL"], "v0": -1})) > 0
    assert len(mn.validar(2, {**mn.PRESETS[2]["NORMAL"], "D0": 80})) > 0
    assert len(mn.validar(3, {**mn.PRESETS[3]["NORMAL"], "h": 0.3})) > 0
    assert len(mn.validar(4, {**mn.PRESETS[4]["NORMAL"], "n_nodos": 2})) > 0

    print("TEST MOTOR OK: 12 presets y validaciones superados.")


if __name__ == "__main__":
    run_all()
