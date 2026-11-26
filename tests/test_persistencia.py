"""Pruebas de persistencia, migración y API Flask para SIMTELE-RISK."""

import os
import shutil
import sqlite3
import sys
import tempfile

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REAL_DB = os.path.join(BASE_DIR, "simtele_risk.db")


def _approx_equal(a, b, tol):
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_approx_equal(x, y, tol) for x, y in zip(a, b))
    if a is None or b is None:
        return a == b
    return abs(float(a) - float(b)) <= tol


def main():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_db = os.path.join(tmpdir, "test_simtele.db")
        os.environ["SIMTELE_DB"] = tmp_db
        sys.path.insert(0, BASE_DIR)

        import app as flask_app
        flask_app.init_db()
        client = flask_app.app.test_client()

        # 1. Estado
        r_est = client.get("/api/estado")
        assert r_est.status_code == 200
        assert r_est.get_json()["version"] == "v3"

        # 2. POST /api/ejecutar/1 NORMAL -> guarda y devuelve sim_id
        r_post = client.post("/api/ejecutar/1", json={"escenario": "NORMAL", "guardar": True})
        assert r_post.status_code == 200, r_post.data
        resp_post = r_post.get_json()
        assert "sim_id" in resp_post
        sim_id = resp_post["sim_id"]

        # 3. Listado y filtros
        r_list = client.get("/api/simulaciones")
        assert r_list.status_code == 200
        ids = [x["sim_id"] for x in r_list.get_json()]
        assert sim_id in ids

        r_filt = client.get("/api/simulaciones?modulo=1&escenario=NORMAL")
        assert r_filt.status_code == 200
        assert any(x["sim_id"] == sim_id for x in r_filt.get_json())

        # 4. Detalle completo tras limpiar caché de inicialización (simula reinicio)
        flask_app._INITIALIZED_DBS.clear()
        r_det = client.get(f"/api/simulaciones/{sim_id}")
        assert r_det.status_code == 200
        det = r_det.get_json()
        assert det["snapshot"] == {k: v for k, v in resp_post.items() if k != "sim_id"}
        assert len(det["ejecuciones"]) == len(resp_post["metodos"])
        assert all(len(ej["iteraciones"]) > 0 for ej in det["ejecuciones"])

        # 5. Relanzar con params guardados y guardar=False -> reproducibilidad dentro de tolerancia
        r_rel = client.post("/api/ejecutar/1", json={
            "escenario": det["escenario"],
            "params": det["params"],
            "guardar": False,
        })
        assert r_rel.status_code == 200
        rel_data = r_rel.get_json()
        assert "sim_id" not in rel_data
        for m_old, m_new in zip(det["snapshot"]["metodos"], rel_data["metodos"]):
            tol = max(1e-9, m_old.get("tolerancia") or 0.0)
            assert _approx_equal(m_old["resultado"], m_new["resultado"], tol), (m_old["id"], m_old["resultado"], m_new["resultado"])

        # 6. Validación negativa -> 400
        r_bad = client.post("/api/ejecutar/1", json={"escenario": "NORMAL", "params": {"v0": -1}})
        assert r_bad.status_code == 400
        assert len(r_bad.get_json()["errores"]) > 0

        # 7. Migración sobre copia de la BD real
        if os.path.exists(REAL_DB):
            mig_db = os.path.join(tmpdir, "mig_simtele.db")
            shutil.copy2(REAL_DB, mig_db)
            os.environ["SIMTELE_DB"] = mig_db
            flask_app._INITIALIZED_DBS.clear()
            flask_app.init_db()

            with sqlite3.connect(mig_db) as c:
                cols = [r[1] for r in c.execute("PRAGMA table_info(simulacion)").fetchall()]
                assert "snapshot_json" in cols
            c.close()

            r_old_list = client.get("/api/simulaciones")
            assert r_old_list.status_code == 200
            old_rows = r_old_list.get_json()
            assert len(old_rows) > 0
            old_id = old_rows[0]["sim_id"]
            r_old_det = client.get(f"/api/simulaciones/{old_id}")
            assert r_old_det.status_code == 200
            assert r_old_det.get_json()["snapshot"] is None

            # Confirmar que tras migrar también se puede guardar un registro nuevo
            r_new = client.post("/api/ejecutar/2", json={"escenario": "NORMAL", "guardar": True})
            assert r_new.status_code == 200
            assert "sim_id" in r_new.get_json()

    print("TEST PERSISTENCIA OK")


if __name__ == "__main__":
    main()
