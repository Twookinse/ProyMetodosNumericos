/* Motor numérico puro para SIMTELE-RISK (Semana 3, respaldo autónomo JS).
 * Port 1:1 de motor_numerico.py con paridad de esquema JSON y operaciones.
 */
(function (root) {
    "use strict";

    const AVISOS_GENERALES = [
        "Los datos y parámetros empleados son sintéticos y supuestos para fines académicos.",
        "Los escenarios son hipotéticos (inspirados en sistemas de transporte por cable) y no describen fallas reales.",
        "Aplicación estrictamente educativa: sin conexión ni control sobre equipos físicos reales."
    ];

    const PRESETS = {
        1: {
            NORMAL: {
                v0: 6.0, a0: 1.5, b: 0.05, t_r: 0.5, d_disp: 25.0,
                h: 0.1, n: 16, tol: 1e-8, max_iter: 100, formulacion: "simple"
            },
            ESTRES: {
                v0: 8.5, a0: 0.75, b: 0.02, t_r: 1.0, d_disp: 25.0,
                h: 0.5, n: 4, tol: 1e-8, max_iter: 100, formulacion: "simple"
            },
            MAL_CONDICIONADO: {
                v0: 6.0, a0: 1.5, b: 0.05, t_r: 0.5, d_disp: 25.0,
                h: 0.1, n: 16, tol: 1e-8, max_iter: 100, formulacion: "doble"
            }
        },
        2: {
            NORMAL: {
                sistema: "base", delta_b: 0.0, tol_sl: 1e-6, max_iter_sl: 500,
                D0: 10.0, alpha: 3.5, beta: 0.75, d_umbral: 75.0, retraso: 1.0,
                tol_raiz: 1e-8, max_iter_raiz: 100
            },
            ESTRES: {
                sistema: "base", delta_b: 0.05, tol_sl: 1e-10, max_iter_sl: 500,
                D0: 10.0, alpha: 6.0, beta: 1.2, d_umbral: 75.0, retraso: 2.0,
                tol_raiz: 1e-10, max_iter_raiz: 100
            },
            MAL_CONDICIONADO: {
                sistema: "hilbert", delta_b: 0.0, tol_sl: 1e-8, max_iter_sl: 2000,
                D0: 10.0, alpha: 8.0, beta: -0.5, d_umbral: 41.9999, retraso: 0.5,
                tol_raiz: 1e-10, max_iter_raiz: 100
            }
        },
        3: {
            NORMAL: {
                m: 800.0, c: 320.0, k: 1280.0, x0: 0.35, v0: 0.0,
                F0: 0.0, wf: 0.0, T: 10.0, h: 0.05, n: 64, tol_romberg: 1e-8
            },
            ESTRES: {
                m: 800.0, c: 80.0, k: 1280.0, x0: 0.35, v0: 0.0,
                F0: 200.0, wf: 1.2, T: 40.0, h: 0.25, n: 64, tol_romberg: 1e-8
            },
            MAL_CONDICIONADO: {
                m: 800.0, c: 8.0, k: 1280.0, x0: 0.35, v0: 0.0,
                F0: 200.0, wf: 1.264911, T: 40.0, h: 0.1, n: 64, tol_romberg: 1e-8
            }
        },
        4: {
            NORMAL: {
                n_nodos: 7, t_fin: 6.0, distribucion: "equiespaciados", sigma: 0.0, y_umbral: 2.5
            },
            ESTRES: {
                n_nodos: 7, t_fin: 6.0, distribucion: "equiespaciados", sigma: 0.05, y_umbral: 2.5
            },
            MAL_CONDICIONADO: {
                n_nodos: 21, t_fin: 12.0, distribucion: "equiespaciados", sigma: 0.01, y_umbral: 2.5
            }
        }
    };

    const _INT_FIELDS = new Set(["n", "max_iter", "max_iter_sl", "max_iter_raiz", "n_nodos"]);
    const _STR_FIELDS = new Set(["formulacion", "sistema", "distribucion"]);

    function _esNumeroFinito(val) {
        if (typeof val === "boolean" || val === null || val === undefined || val === "" || typeof val === "object") {
            return false;
        }
        const num = Number(val);
        return Number.isFinite(num);
    }

    function _esEntero(val) {
        if (!_esNumeroFinito(val)) return false;
        const num = Number(val);
        return Math.abs(num - Math.round(num)) < 1e-12;
    }

    function _normInf(vec) {
        let m = 0.0;
        for (let i = 0; i < vec.length; i++) {
            const a = Math.abs(vec[i]);
            if (a > m) m = a;
        }
        return m;
    }

    function _norm2(vec) {
        let s = 0.0;
        for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
        return Math.sqrt(s);
    }

    function _calcularErrores(aprox, ref) {
        if (ref === null || ref === undefined || aprox === null || aprox === undefined) {
            return [null, null, null];
        }
        let eAbs, nRef;
        if (Array.isArray(aprox) && Array.isArray(ref)) {
            if (aprox.length !== ref.length) return [null, null, null];
            const diff = [];
            const refs = [];
            for (let i = 0; i < aprox.length; i++) {
                diff.push(Math.abs(Number(aprox[i]) - Number(ref[i])));
                refs.push(Number(ref[i]));
            }
            eAbs = _normInf(diff);
            nRef = _normInf(refs);
        } else {
            eAbs = Math.abs(Number(aprox) - Number(ref));
            nRef = Math.abs(Number(ref));
        }
        const eRel = nRef > 1e-12 ? eAbs / nRef : null;
        const ePct = eRel !== null ? eRel * 100.0 : null;
        return [eAbs, eRel, ePct];
    }

    function _recortarIteraciones(iters, esEdo) {
        const total = iters.length;
        if (total <= 200) return iters;
        if (esEdo) {
            const step = Math.max(1, Math.ceil(total / 200));
            const rec = [];
            for (let i = 0; i < total; i += step) rec.push(iters[i]);
            if (rec[rec.length - 1] !== iters[total - 1]) rec.push(iters[total - 1]);
            return rec;
        }
        return iters.slice(0, 199).concat([iters[total - 1]]);
    }

    function _submuestrearIndices(total, maxPts) {
        const idx = [];
        if (total <= maxPts) {
            for (let i = 0; i < total; i++) idx.push(i);
            return idx;
        }
        const step = Math.max(1, Math.ceil(total / maxPts));
        for (let i = 0; i < total; i += step) idx.push(i);
        if (idx[idx.length - 1] !== total - 1) idx.push(total - 1);
        return idx;
    }

    function _coercerParams(modulo, escenario, params) {
        const base = JSON.parse(JSON.stringify(PRESETS[modulo][escenario]));
        if (params && typeof params === "object") {
            for (const k of Object.keys(params)) {
                if (Object.prototype.hasOwnProperty.call(base, k)) {
                    base[k] = params[k];
                }
            }
        }
        for (const k of Object.keys(base)) {
            const v = base[k];
            if (_STR_FIELDS.has(k)) {
                base[k] = v !== null && v !== undefined ? String(v) : "";
            } else if (_INT_FIELDS.has(k)) {
                if (_esEntero(v)) base[k] = Math.round(Number(v));
            } else {
                if (_esNumeroFinito(v)) base[k] = Number(v);
            }
        }
        return base;
    }

    function _raizCuadraticaM2(D0, alpha, beta, dUmbral) {
        const cTerm = D0 - dUmbral;
        if (Math.abs(beta) < 1e-14) {
            if (Math.abs(alpha) < 1e-14) return null;
            const tLin = -cTerm / alpha;
            return tLin >= 0.0 ? tLin : null;
        }
        const disc = alpha * alpha - 4.0 * beta * cTerm;
        if (disc < 0.0) return null;
        const sq = Math.sqrt(Math.max(0.0, disc));
        const r1 = (-alpha - sq) / (2.0 * beta);
        const r2 = (-alpha + sq) / (2.0 * beta);
        const cand = [r1, r2].filter(r => r >= -1e-12);
        if (cand.length === 0) return null;
        return Math.max(0.0, Math.min(...cand));
    }

    function validar(modulo, params) {
        const mod = Number(modulo);
        if (!Number.isInteger(mod) || !PRESETS[mod]) {
            return ["Módulo inválido (debe ser 1, 2, 3 o 4)."];
        }
        if (!params || typeof params !== "object" || Array.isArray(params)) {
            return ["Los parámetros deben ser un objeto."];
        }
        const errs = [];

        if (mod === 1) {
            const reqNum = ["v0", "a0", "b", "t_r", "d_disp", "h", "n", "tol", "max_iter"];
            for (const k of reqNum) {
                if (!Object.prototype.hasOwnProperty.call(params, k) || !_esNumeroFinito(params[k])) {
                    errs.push(`El parámetro '${k}' debe ser un número finito.`);
                }
            }
            if (errs.length > 0) return errs;
            const v0 = Number(params.v0);
            const a0 = Number(params.a0);
            const b = Number(params.b);
            const t_r = Number(params.t_r);
            const d_disp = Number(params.d_disp);
            const h = Number(params.h);
            const tol = Number(params.tol);
            const form = String(params.formulacion ?? "");
            if (!(v0 > 0.0 && v0 <= 20.0)) errs.push("v0 debe cumplir 0 < v0 <= 20.");
            if (!(a0 > 0.0 && a0 <= 5.0)) errs.push("a0 debe cumplir 0 < a0 <= 5.");
            if (!(b >= 0.0 && b <= 1.0)) errs.push("b debe cumplir 0 <= b <= 1.");
            if (!(t_r >= 0.0 && t_r <= 5.0)) errs.push("t_r debe cumplir 0 <= t_r <= 5.");
            if (!(d_disp > 0.0)) errs.push("d_disp debe ser mayor que 0.");
            if (!(h > 0.0 && h <= 1.0)) errs.push("h debe cumplir 0 < h <= 1.");
            if (!_esEntero(params.n)) {
                errs.push("n debe ser un entero par entre 2 y 1024.");
            } else {
                const nVal = Math.round(Number(params.n));
                if (nVal < 2 || nVal > 1024 || nVal % 2 !== 0) errs.push("n debe ser un entero par entre 2 y 1024.");
            }
            if (!(tol >= 1e-14 && tol <= 1e-2)) errs.push("tol debe cumplir 1e-14 <= tol <= 1e-2.");
            if (!_esEntero(params.max_iter)) {
                errs.push("max_iter debe ser un entero entre 1 y 1000.");
            } else {
                const mi = Math.round(Number(params.max_iter));
                if (mi < 1 || mi > 1000) errs.push("max_iter debe ser un entero entre 1 y 1000.");
            }
            if (form !== "simple" && form !== "doble") errs.push("formulacion debe ser 'simple' o 'doble'.");
        } else if (mod === 2) {
            const reqNum = ["delta_b", "tol_sl", "max_iter_sl", "D0", "alpha", "beta", "d_umbral", "retraso", "tol_raiz", "max_iter_raiz"];
            for (const k of reqNum) {
                if (!Object.prototype.hasOwnProperty.call(params, k) || !_esNumeroFinito(params[k])) {
                    errs.push(`El parámetro '${k}' debe ser un número finito.`);
                }
            }
            if (errs.length > 0) return errs;
            const sistema = String(params.sistema ?? "");
            const deltaB = Number(params.delta_b);
            const tolSl = Number(params.tol_sl);
            const D0 = Number(params.D0);
            const alpha = Number(params.alpha);
            const beta = Number(params.beta);
            const dUmbral = Number(params.d_umbral);
            const retraso = Number(params.retraso);
            const tolRaiz = Number(params.tol_raiz);
            if (sistema !== "base" && sistema !== "hilbert") errs.push("sistema debe ser 'base' o 'hilbert'.");
            if (!(deltaB >= 0.0 && deltaB <= 1.0)) errs.push("delta_b debe cumplir 0 <= delta_b <= 1.");
            if (!(tolSl >= 1e-14 && tolSl <= 1e-2)) errs.push("tol_sl debe cumplir 1e-14 <= tol_sl <= 1e-2.");
            if (!_esEntero(params.max_iter_sl) || Math.round(Number(params.max_iter_sl)) < 1 || Math.round(Number(params.max_iter_sl)) > 5000) {
                errs.push("max_iter_sl debe ser un entero entre 1 y 5000.");
            }
            if (!(D0 < dUmbral)) errs.push("D0 debe ser menor que d_umbral.");
            if (retraso < 0.0) errs.push("retraso debe ser mayor o igual a 0.");
            if (!(tolRaiz >= 1e-14 && tolRaiz <= 1e-2)) errs.push("tol_raiz debe cumplir 1e-14 <= tol_raiz <= 1e-2.");
            if (!_esEntero(params.max_iter_raiz) || Math.round(Number(params.max_iter_raiz)) < 1 || Math.round(Number(params.max_iter_raiz)) > 1000) {
                errs.push("max_iter_raiz debe ser un entero entre 1 y 1000.");
            }
            if (D0 < dUmbral && _raizCuadraticaM2(D0, alpha, beta, dUmbral) === null) {
                errs.push("El indicador nunca alcanza el umbral con estos parámetros.");
            }
        } else if (mod === 3) {
            const reqNum = ["m", "c", "k", "x0", "v0", "F0", "wf", "T", "h", "n", "tol_romberg"];
            for (const kName of reqNum) {
                if (!Object.prototype.hasOwnProperty.call(params, kName) || !_esNumeroFinito(params[kName])) {
                    errs.push(`El parámetro '${kName}' debe ser un número finito.`);
                }
            }
            if (errs.length > 0) return errs;
            const m = Number(params.m);
            const c = Number(params.c);
            const kVal = Number(params.k);
            const F0 = Number(params.F0);
            const wf = Number(params.wf);
            const T = Number(params.T);
            const h = Number(params.h);
            const tolR = Number(params.tol_romberg);
            if (m <= 0.0) errs.push("m debe ser mayor que 0.");
            if (kVal <= 0.0) errs.push("k debe ser mayor que 0.");
            if (c < 0.0) errs.push("c debe ser >= 0.");
            if (F0 < 0.0) errs.push("F0 debe ser >= 0.");
            if (wf < 0.0) errs.push("wf debe ser >= 0.");
            if (T <= 0.0) errs.push("T debe ser mayor que 0.");
            if (h <= 0.0) errs.push("h debe ser mayor que 0.");
            if (T > 0.0 && h > 0.0) {
                const nSteps = Math.round(T / h);
                if (Math.abs(nSteps * h - T) >= 1e-9 * T) {
                    errs.push("T debe ser múltiplo de h.");
                } else if (nSteps < 10 || nSteps > 4000) {
                    errs.push("El número de pasos N = T/h debe estar entre 10 y 4000.");
                }
            }
            if (!_esEntero(params.n)) {
                errs.push("n debe ser una potencia de 2 entre 2 y 1024.");
            } else {
                const nVal = Math.round(Number(params.n));
                if (nVal < 2 || nVal > 1024 || (nVal & (nVal - 1)) !== 0) {
                    errs.push("n debe ser una potencia de 2 entre 2 y 1024.");
                }
            }
            if (!(tolR >= 1e-14 && tolR <= 1e-2)) errs.push("tol_romberg debe cumplir 1e-14 <= tol_romberg <= 1e-2.");
        } else if (mod === 4) {
            const reqNum = ["n_nodos", "t_fin", "sigma", "y_umbral"];
            for (const kName of reqNum) {
                if (!Object.prototype.hasOwnProperty.call(params, kName) || !_esNumeroFinito(params[kName])) {
                    errs.push(`El parámetro '${kName}' debe ser un número finito.`);
                }
            }
            if (errs.length > 0) return errs;
            const tFin = Number(params.t_fin);
            const sigma = Number(params.sigma);
            const dist = String(params.distribucion ?? "");
            if (!_esEntero(params.n_nodos) || Math.round(Number(params.n_nodos)) < 3 || Math.round(Number(params.n_nodos)) > 30) {
                errs.push("n_nodos debe ser un entero entre 3 y 30.");
            }
            if (!(tFin > 0.0 && tFin <= 30.0)) errs.push("t_fin debe cumplir 0 < t_fin <= 30.");
            if (!(sigma >= 0.0 && sigma <= 0.5)) errs.push("sigma debe cumplir 0 <= sigma <= 0.5.");
            if (dist !== "equiespaciados" && dist !== "chebyshev") {
                errs.push("distribucion debe ser 'equiespaciados' o 'chebyshev'.");
            }
        }
        return errs;
    }

    // --- M1 ---
    function _m1Analitica(v0, a0, b) {
        let tDet, vEx, xEx;
        if (b > 1e-12) {
            const K = v0 + a0 / b;
            tDet = Math.log(1.0 + b * v0 / a0) / b;
            vEx = (t) => K * Math.exp(-b * t) - a0 / b;
            xEx = (t) => K * (1.0 - Math.exp(-b * t)) / b - (a0 / b) * t;
        } else {
            tDet = v0 / a0;
            vEx = (t) => v0 - a0 * t;
            xEx = (t) => v0 * t - 0.5 * a0 * t * t;
        }
        return { vEx, xEx, tDet, dFren: xEx(tDet) };
    }

    function _m1Edo(metodo, a0, b, v0, h, tDet, xEx, vEx) {
        const t0Cpu = performance.now();
        const N = Math.max(1, Math.ceil(tDet / h - 1e-12));
        let t = 0.0, x = 0.0, v = v0;
        const iters = [], ts = [], xs = [], vs = [], rxList = [], rvList = [], errsList = [];
        for (let k = 0; k <= N; k++) {
            const rx = xEx(t), rv = vEx(t);
            const [eAbs, eRel] = _calcularErrores([x, v], [rx, rv]);
            iters.push({ n: k, t, aprox: [x, v], residual: null, error_abs: eAbs, error_rel: eRel });
            ts.push(t); xs.push(x); vs.push(v); rxList.push(rx); rvList.push(rv);
            errsList.push(eAbs !== null ? eAbs : 0.0);
            if (k === N) break;
            const tNext = k === N - 1 ? tDet : (k + 1) * h;
            const hk = tNext - t;
            if (metodo === "rk2") {
                const k1x = v, k1v = -(a0 + b * v);
                const xp = x + hk * k1x, vp = v + hk * k1v;
                const k2x = vp, k2v = -(a0 + b * vp);
                x = x + 0.5 * hk * (k1x + k2x);
                v = v + 0.5 * hk * (k1v + k2v);
            } else {
                const k1x = v, k1v = -(a0 + b * v);
                const x2 = x + 0.5 * hk * k1x, v2 = v + 0.5 * hk * k1v;
                const k2x = v2, k2v = -(a0 + b * v2);
                const x3 = x + 0.5 * hk * k2x, v3 = v + 0.5 * hk * k2v;
                const k3x = v3, k3v = -(a0 + b * v3);
                const x4 = x + hk * k3x, v4 = v + hk * k3v;
                const k4x = v4, k4v = -(a0 + b * v4);
                x = x + (hk / 6.0) * (k1x + 2.0 * k2x + 2.0 * k3x + k4x);
                v = v + (hk / 6.0) * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
            }
            t = tNext;
        }
        return { final: [x, v], iters, ts, xs, vs, rx: rxList, rv: rvList, errs: errsList, ms: performance.now() - t0Cpu };
    }

    function _trapecioFn(f, a, bLim, n) {
        const h = (bLim - a) / n;
        let s = 0.5 * (f(a) + f(bLim));
        for (let i = 1; i < n; i++) s += f(a + i * h);
        return s * h;
    }

    function _simpsonFn(f, a, bLim, n) {
        if (n % 2 !== 0) n += 1;
        const h = (bLim - a) / n;
        let sImp = 0.0, sPar = 0.0;
        for (let i = 1; i < n; i += 2) sImp += f(a + i * h);
        for (let i = 2; i < n; i += 2) sPar += f(a + i * h);
        return (h / 3.0) * (f(a) + 4.0 * sImp + 2.0 * sPar + f(bLim));
    }

    function _rombergFn(f, a, bLim, tol, maxNiveles = 10) {
        const t0Cpu = performance.now();
        const R = [], diagRows = [];
        let convergio = false;
        let criterio = `máximo de ${maxNiveles} niveles alcanzado`;
        for (let k = 0; k < maxNiveles; k++) {
            const nInt = 1 << k;
            const row = new Array(k + 1).fill(0.0);
            if (k === 0) {
                row[0] = 0.5 * (bLim - a) * (f(a) + f(bLim));
            } else {
                const hK = (bLim - a) / nInt;
                let sMid = 0.0;
                for (let i = 1; i < nInt; i += 2) sMid += f(a + i * hK);
                row[0] = 0.5 * R[k - 1][0] + hK * sMid;
                let pow4 = 4.0;
                for (let j = 1; j <= k; j++) {
                    row[j] = row[j - 1] + (row[j - 1] - R[k - 1][j - 1]) / (pow4 - 1.0);
                    pow4 *= 4.0;
                }
            }
            R.push(row);
            const res = k > 0 ? Math.abs(row[k] - R[k - 1][k - 1]) : null;
            diagRows.push({ n: k + 1, subintervalos: nInt, aprox: row[k], residual: res });
            if (k > 0 && res !== null && res < tol) {
                convergio = true;
                criterio = `|R[k,k]-R[k-1,k-1]| < ${tol}`;
                break;
            }
        }
        return { valor: R[R.length - 1][R.length - 1], diagRows, R, convergio, criterio, ms: performance.now() - t0Cpu };
    }

    function _resolverRaizBiseccion(f, a, bLim, tol, maxIter, ref) {
        const t0Cpu = performance.now();
        const fa = f(a), fb = f(bLim);
        const iters = [];
        if (fa * fb > 0.0) {
            return { x: a, iters, convergio: false, criterio: "sin cambio de signo en el intervalo", ms: performance.now() - t0Cpu };
        }
        let lo = a, hi = bLim, flo = fa, c = lo, convergio = false;
        let criterio = `máximo de ${maxIter} iteraciones alcanzado`;
        for (let k = 1; k <= maxIter; k++) {
            c = 0.5 * (lo + hi);
            const fc = f(c);
            const [eAbs, eRel] = _calcularErrores(c, ref);
            iters.push({ n: k, aprox: c, residual: Math.abs(fc), error_abs: eAbs, error_rel: eRel, a: lo, b: hi });
            if (Math.abs(fc) < tol || 0.5 * (hi - lo) < tol) {
                convergio = true;
                criterio = `|f(c)| < ${tol} o semiancho < ${tol}`;
                break;
            }
            if (flo * fc <= 0.0) hi = c;
            else { lo = c; flo = fc; }
        }
        return { x: c, iters, convergio, criterio, ms: performance.now() - t0Cpu };
    }

    function _resolverRaizNewton(f, df, x0, tol, maxIter, ref) {
        const t0Cpu = performance.now();
        let x = x0, convergio = false;
        const iters = [];
        let criterio = `máximo de ${maxIter} iteraciones alcanzado`;
        for (let k = 1; k <= maxIter; k++) {
            const fx = f(x), dfx = df(x);
            if (Math.abs(dfx) < 1e-14) {
                criterio = "derivada nula (|f'| < 1e-14)";
                convergio = false;
                break;
            }
            const xNew = x - fx / dfx;
            if (!Number.isFinite(xNew)) {
                criterio = "valor no finito";
                convergio = false;
                break;
            }
            const fxNew = f(xNew);
            const [eAbs, eRel] = _calcularErrores(xNew, ref);
            iters.push({ n: k, aprox: xNew, residual: Math.abs(fxNew), error_abs: eAbs, error_rel: eRel });
            if (Math.abs(xNew - x) < tol || Math.abs(fxNew) < tol) {
                x = xNew;
                convergio = true;
                criterio = `|Δx| < ${tol} o |f(x)| < ${tol}`;
                break;
            }
            x = xNew;
        }
        return { x, iters, convergio, criterio, ms: performance.now() - t0Cpu };
    }

    function _resolverRaizSecante(f, x0, x1, tol, maxIter, ref) {
        const t0Cpu = performance.now();
        let a = x0, bPt = x1, fa = f(a), fb = f(bPt), convergio = false;
        const iters = [];
        let criterio = `máximo de ${maxIter} iteraciones alcanzado`;
        for (let k = 1; k <= maxIter; k++) {
            const den = fb - fa;
            if (Math.abs(den) < 1e-14) {
                criterio = "denominador nulo (|f(x1)-f(x0)| < 1e-14)";
                convergio = false;
                break;
            }
            const xNew = bPt - fb * (bPt - a) / den;
            if (!Number.isFinite(xNew)) {
                criterio = "valor no finito";
                convergio = false;
                break;
            }
            const fNew = f(xNew);
            const [eAbs, eRel] = _calcularErrores(xNew, ref);
            iters.push({ n: k, aprox: xNew, residual: Math.abs(fNew), error_abs: eAbs, error_rel: eRel });
            if (Math.abs(xNew - bPt) < tol || Math.abs(fNew) < tol) {
                bPt = xNew;
                convergio = true;
                criterio = `|Δx| < ${tol} o |f(x)| < ${tol}`;
                break;
            }
            a = bPt; fa = fb;
            bPt = xNew; fb = fNew;
        }
        return { x: bPt, iters, convergio, criterio, ms: performance.now() - t0Cpu };
    }

    function _ejecutarM1(escenario, p) {
        const v0 = Number(p.v0), a0 = Number(p.a0), b = Number(p.b), tR = Number(p.t_r);
        const dDisp = Number(p.d_disp), h = Number(p.h), n = Math.round(Number(p.n));
        const tol = Number(p.tol), maxIter = Math.round(Number(p.max_iter)), formulacion = String(p.formulacion);

        const { vEx, xEx, tDet, dFren } = _m1Analitica(v0, a0, b);
        const dTotalRef = v0 * tR + dFren;
        const tTotal = tR + tDet;
        const refEdo = [dFren, 0.0];

        const resRk2 = _m1Edo("rk2", a0, b, v0, h, tDet, xEx, vEx);
        const resRk4 = _m1Edo("rk4", a0, b, v0, h, tDet, xEx, vEx);
        const resRk2H = _m1Edo("rk2", a0, b, v0, h / 2.0, tDet, xEx, vEx);
        const resRk4H = _m1Edo("rk4", a0, b, v0, h / 2.0, tDet, xEx, vEx);

        const [eRk2H, erRk2H, epRk2H] = _calcularErrores(resRk2.final, refEdo);
        const [eRk4H, erRk4H, epRk4H] = _calcularErrores(resRk4.final, refEdo);
        const [eRk2H2] = _calcularErrores(resRk2H.final, refEdo);
        const [eRk4H2] = _calcularErrores(resRk4H.final, refEdo);

        const ordenRk2 = (eRk2H && eRk2H2 && eRk2H > 1e-13 && eRk2H2 > 1e-13) ? Math.log2(eRk2H / eRk2H2) : null;
        const ordenRk4 = (eRk4H && eRk4H2 && eRk4H > 1e-13 && eRk4H2 > 1e-13) ? Math.log2(eRk4H / eRk4H2) : null;

        const nsRef = [];
        let curN = 2;
        while (curN < n) { nsRef.push(curN); curN *= 2; }
        nsRef.push(n);

        const refinamiento = [], itersTrap = [], itersSimp = [];
        const t0Tr = performance.now();
        for (let idx = 0; idx < nsRef.length; idx++) {
            const nk = nsRef[idx];
            const valT = _trapecioFn(vEx, 0.0, tDet, nk);
            const [etAbs, etRel] = _calcularErrores(valT, dFren);
            itersTrap.push({ n: idx + 1, subintervalos: nk, aprox: valT, residual: null, error_abs: etAbs, error_rel: etRel });
            refinamiento.push({ n: nk, trapecio: valT, err_trap: etAbs, simpson: 0.0, err_simp: 0.0 });
        }
        const msTrap = performance.now() - t0Tr;

        const t0Sp = performance.now();
        for (let idx = 0; idx < nsRef.length; idx++) {
            const nk = nsRef[idx];
            const valS = _simpsonFn(vEx, 0.0, tDet, nk);
            const [esAbs, esRel] = _calcularErrores(valS, dFren);
            itersSimp.push({ n: idx + 1, subintervalos: nk, aprox: valS, residual: null, error_abs: esAbs, error_rel: esRel });
            refinamiento[idx].simpson = valS;
            refinamiento[idx].err_simp = esAbs;
        }
        const msSimp = performance.now() - t0Sp;

        const ITrap = refinamiento[refinamiento.length - 1].trapecio;
        const ISimp = refinamiento[refinamiento.length - 1].simpson;
        const [eTrAbs, eTrRel, eTrPct] = _calcularErrores(ITrap, dFren);
        const [eSpAbs, eSpRel, eSpPct] = _calcularErrores(ISimp, dFren);

        const romb = _rombergFn(vEx, 0.0, tDet, tol);
        for (const r of romb.diagRows) {
            const [ea, er] = _calcularErrores(r.aprox, dFren);
            r.error_abs = ea;
            r.error_rel = er;
        }
        const [eRmAbs, eRmRel, eRmPct] = _calcularErrores(romb.valor, dFren);

        const fRaiz = (t) => {
            const vt = vEx(t);
            return formulacion === "simple" ? vt : vt * Math.abs(vt);
        };
        const dfRaiz = (t) => {
            const vt = vEx(t);
            const dv = -(a0 + b * vt);
            return formulacion === "simple" ? dv : 2.0 * Math.abs(vt) * dv;
        };

        const rBis = _resolverRaizBiseccion(fRaiz, 0.0, v0 / a0 + 1.0, tol, maxIter, tDet);
        const rNew = _resolverRaizNewton(fRaiz, dfRaiz, 0.0, tol, maxIter, tDet);
        const rSec = _resolverRaizSecante(fRaiz, 0.0, v0 / a0, tol, maxIter, tDet);

        const [ebAbs, ebRel, ebPct] = _calcularErrores(rBis.x, tDet);
        const [enAbs, enRel, enPct] = _calcularErrores(rNew.x, tDet);
        const [esAbs, esRel, esPct] = _calcularErrores(rSec.x, tDet);

        const derivadaEnRaiz = Math.abs(dfRaiz(tDet));
        const dTotalNum = v0 * tR + ISimp;
        const margen = dDisp - dTotalNum;
        const cumple = dTotalNum <= dDisp;

        const sensibilidad = [];
        for (const [pname, pval] of [["v0", v0], ["a0", a0], ["b", b], ["t_r", tR]]) {
            if (pval === 0.0) {
                sensibilidad.push({ parametro: pname, salida: "d_total_num", base: dTotalNum, perturbado: dTotalNum, S: null, tipo: "relativa", nota: "parámetro nulo" });
            } else {
                const kw = { v0, a0, b, t_r: tR };
                kw[pname] = pval * 1.01;
                const anP = _m1Analitica(kw.v0, kw.a0, kw.b);
                const outPert = kw.v0 * kw.t_r + _simpsonFn(anP.vEx, 0.0, anP.tDet, n);
                const SVal = Math.abs(dTotalNum) > 1e-14 ? ((outPert - dTotalNum) / dTotalNum) / 0.01 : null;
                sensibilidad.push({ parametro: pname, salida: "d_total_num", base: dTotalNum, perturbado: outPert, S: SVal, tipo: "relativa", nota: null });
            }
        }

        const idxS = _submuestrearIndices(resRk4.ts.length, 1000);
        const series = {
            t: idxS.map(i => resRk4.ts[i]),
            rk2_x: idxS.map(i => resRk2.xs[i]),
            rk2_v: idxS.map(i => resRk2.vs[i]),
            rk4_x: idxS.map(i => resRk4.xs[i]),
            rk4_v: idxS.map(i => resRk4.vs[i]),
            ref_x: idxS.map(i => resRk4.rx[i]),
            ref_v: idxS.map(i => resRk4.rv[i]),
            err_rk2: idxS.map(i => resRk2.errs[i]),
            err_rk4: idxS.map(i => resRk4.errs[i])
        };

        const metodos = [
            {
                id: "rk2", familia: "EDO", nombre: "RK2 (Heun)", tolerancia: null, paso: h, max_iter: null,
                convergio: true, tiempo_ms: resRk2.ms, criterio_parada: `integración fija en [0, ${tDet.toFixed(4)}] s`,
                resultado: resRk2.final, referencia: refEdo, error_abs: eRk2H, error_rel: erRk2H, error_pct: epRk2H,
                residual: null, iteraciones: _recortarIteraciones(resRk2.iters, true),
                interpretacion: `Estado final [x, v] con orden global O(h^2); error máximo respecto a solución analítica: ${eRk2H.toExponential(3)}.`
            },
            {
                id: "rk4", familia: "EDO", nombre: "RK4 (Clásico)", tolerancia: null, paso: h, max_iter: null,
                convergio: true, tiempo_ms: resRk4.ms, criterio_parada: `integración fija en [0, ${tDet.toFixed(4)}] s`,
                resultado: resRk4.final, referencia: refEdo, error_abs: eRk4H, error_rel: erRk4H, error_pct: epRk4H,
                residual: null, iteraciones: _recortarIteraciones(resRk4.iters, true),
                interpretacion: `Estado final [x, v] con orden global O(h^4); error máximo respecto a solución analítica: ${eRk4H.toExponential(3)}.`
            },
            {
                id: "trapecio", familia: "Integración", nombre: "Trapecio compuesto", tolerancia: null, paso: tDet / n, max_iter: n,
                convergio: true, tiempo_ms: msTrap, criterio_parada: `n = ${n} subintervalos`,
                resultado: ITrap, referencia: dFren, error_abs: eTrAbs, error_rel: eTrRel, error_pct: eTrPct,
                residual: null, iteraciones: _recortarIteraciones(itersTrap, false),
                interpretacion: `Distancia de frenado integrada con n=${n} subintervalos (error O(h^2)).`
            },
            {
                id: "simpson", familia: "Integración", nombre: "Simpson 1/3 compuesto", tolerancia: null, paso: tDet / n, max_iter: n,
                convergio: true, tiempo_ms: msSimp, criterio_parada: `n = ${n} subintervalos`,
                resultado: ISimp, referencia: dFren, error_abs: eSpAbs, error_rel: eSpRel, error_pct: eSpPct,
                residual: null, iteraciones: _recortarIteraciones(itersSimp, false),
                interpretacion: `Distancia de frenado integrada con n=${n} subintervalos (error O(h^4)).`
            },
            {
                id: "romberg", familia: "Integración", nombre: "Romberg", tolerancia: tol, paso: null, max_iter: 10,
                convergio: romb.convergio, tiempo_ms: romb.ms, criterio_parada: romb.criterio,
                resultado: romb.valor, referencia: dFren, error_abs: eRmAbs, error_rel: eRmRel, error_pct: eRmPct,
                residual: romb.diagRows[romb.diagRows.length - 1].residual, iteraciones: _recortarIteraciones(romb.diagRows, false),
                interpretacion: `Extrapolación de Richardson en ${romb.diagRows.length} niveles hasta precisión ${eRmAbs.toExponential(3)}.`
            },
            {
                id: "biseccion", familia: "Raíces", nombre: "Bisección", tolerancia: tol, paso: null, max_iter: maxIter,
                convergio: rBis.convergio, tiempo_ms: rBis.ms, criterio_parada: rBis.criterio,
                resultado: rBis.x, referencia: tDet, error_abs: ebAbs, error_rel: ebRel, error_pct: ebPct,
                residual: Math.abs(fRaiz(rBis.x)), iteraciones: _recortarIteraciones(rBis.iters, false),
                interpretacion: `Convergencia garantizada por cambio de signo en ${rBis.iters.length} iteraciones (insensible a raíz múltiple).`
            },
            {
                id: "newton", familia: "Raíces", nombre: "Newton-Raphson", tolerancia: tol, paso: null, max_iter: maxIter,
                convergio: rNew.convergio, tiempo_ms: rNew.ms, criterio_parada: rNew.criterio,
                resultado: rNew.x, referencia: tDet, error_abs: enAbs, error_rel: enRel, error_pct: enPct,
                residual: Math.abs(fRaiz(rNew.x)), iteraciones: _recortarIteraciones(rNew.iters, false),
                interpretacion: `Raíz en ${rNew.iters.length} iteraciones; formulación='${formulacion}'.`
            },
            {
                id: "secante", familia: "Raíces", nombre: "Secante", tolerancia: tol, paso: null, max_iter: maxIter,
                convergio: rSec.convergio, tiempo_ms: rSec.ms, criterio_parada: rSec.criterio,
                resultado: rSec.x, referencia: tDet, error_abs: esAbs, error_rel: esRel, error_pct: esPct,
                residual: Math.abs(fRaiz(rSec.x)), iteraciones: _recortarIteraciones(rSec.iters, false),
                interpretacion: `Aproximación sin derivada analítica en ${rSec.iters.length} iteraciones.`
            }
        ];

        const avisos = [...AVISOS_GENERALES];
        if (!cumple) {
            avisos.push(`ALERTA OPERATIVA: la distancia total (${dTotalNum.toFixed(3)} m) excede la distancia disponible (${dDisp.toFixed(3)} m).`);
        }
        if (formulacion === "doble") {
            avisos.push("Mal condicionamiento de raíz: formulación doble produce f'(t*)=0 y degrada a convergencia lineal en Newton/Secante.");
        }

        return {
            modulo: 1, escenario, params: p, metodos,
            indicadores: {
                t_det_ref: tDet, d_fren_ref: dFren, d_total_ref: dTotalRef, d_total_num: dTotalNum,
                t_total: tTotal, margen, cumple, derivada_en_raiz: derivadaEnRaiz,
                orden_rk2: ordenRk2, orden_rk4: ordenRk4
            },
            sensibilidad, series, refinamiento, romberg: romb.R, avisos
        };
    }

    // --- M2 ---
    function _construirSistemaM2(sistema) {
        if (sistema === "base") {
            return [
                [10.0, -1.0, 2.0, 0.0],
                [-1.0, 11.0, -1.0, 3.0],
                [2.0, -1.0, 10.0, -1.0],
                [0.0, 3.0, -1.0, 8.0]
            ];
        }
        const A = [];
        for (let i = 0; i < 4; i++) {
            const row = [];
            for (let j = 0; j < 4; j++) row.push(1.0 / (i + j + 1) + (i === j ? 1e-4 : 0.0));
            A.push(row);
        }
        return A;
    }

    function _matVec(A, x) {
        return A.map(row => row.reduce((s, v, j) => s + v * x[j], 0.0));
    }

    function _gaussianEliminationPP(A, b) {
        const n = b.length;
        const M = A.map((row, i) => [...row, b[i]]);
        for (let col = 0; col < n; col++) {
            let piv = col;
            for (let r = col + 1; r < n; r++) {
                if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
            }
            const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
            if (Math.abs(M[col][col]) < 1e-15) throw new Error("Matriz singular en eliminación gaussiana.");
            for (let r = col + 1; r < n; r++) {
                const fac = M[r][col] / M[col][col];
                for (let c = col; c <= n; c++) M[r][c] -= fac * M[col][c];
            }
        }
        const x = new Array(n).fill(0.0);
        for (let i = n - 1; i >= 0; i--) {
            let s = 0.0;
            for (let j = i + 1; j < n; j++) s += M[i][j] * x[j];
            x[i] = (M[i][n] - s) / M[i][i];
        }
        return x;
    }

    function _luDoolittle(A, b) {
        const n = b.length;
        const L = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1.0 : 0.0)));
        const U = A.map(row => [...row]);
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const fac = U[j][i] / U[i][i];
                L[j][i] = fac;
                for (let k = i; k < n; k++) U[j][k] -= fac * U[i][k];
            }
        }
        const y = new Array(n).fill(0.0);
        for (let i = 0; i < n; i++) {
            let s = 0.0;
            for (let j = 0; j < i; j++) s += L[i][j] * y[j];
            y[i] = b[i] - s;
        }
        const x = new Array(n).fill(0.0);
        for (let i = n - 1; i >= 0; i--) {
            let s = 0.0;
            for (let j = i + 1; j < n; j++) s += U[i][j] * x[j];
            x[i] = (y[i] - s) / U[i][i];
        }
        return x;
    }

    function _residualInf(A, x, b) {
        const ax = _matVec(A, x);
        let m = 0.0;
        for (let i = 0; i < b.length; i++) {
            const d = Math.abs(ax[i] - b[i]);
            if (d > m) m = d;
        }
        return m;
    }

    function _eigvalshSimetrico(mat, tol = 1e-14, maxSweeps = 100) {
        const n = mat.length;
        const A = mat.map(r => [...r]);
        for (let sweep = 0; sweep < maxSweeps; sweep++) {
            let maxOff = 0.0;
            for (let p = 0; p < n - 1; p++) {
                for (let q = p + 1; q < n; q++) {
                    const apq = Math.abs(A[p][q]);
                    if (apq > maxOff) maxOff = apq;
                }
            }
            if (maxOff < tol) break;
            for (let p = 0; p < n - 1; p++) {
                for (let q = p + 1; q < n; q++) {
                    const apq = A[p][q];
                    if (Math.abs(apq) <= 1e-15) continue;
                    const tau = (A[q][q] - A[p][p]) / (2.0 * apq);
                    const t = tau >= 0.0 ? 1.0 / (tau + Math.sqrt(1.0 + tau * tau)) : -1.0 / (-tau + Math.sqrt(1.0 + tau * tau));
                    const c = 1.0 / Math.sqrt(1.0 + t * t);
                    const s = t * c;
                    const app = A[p][p], aqq = A[q][q];
                    A[p][p] = app - t * apq;
                    A[q][q] = aqq + t * apq;
                    A[p][q] = 0.0;
                    A[q][p] = 0.0;
                    for (let r = 0; r < n; r++) {
                        if (r !== p && r !== q) {
                            const arp = A[r][p], arq = A[r][q];
                            A[r][p] = c * arp - s * arq;
                            A[p][r] = A[r][p];
                            A[r][q] = s * arp + c * arq;
                            A[q][r] = A[r][q];
                        }
                    }
                }
            }
        }
        const eigs = [];
        for (let i = 0; i < n; i++) eigs.push(A[i][i]);
        eigs.sort((u, v) => u - v);
        return eigs;
    }

    function _jacobiSl(A, b, xRef, tol, maxIter) {
        const t0 = performance.now();
        const n = b.length;
        let x = new Array(n).fill(0.0);
        const iters = [];
        let convergio = false;
        let criterio = `máximo de ${maxIter} iteraciones alcanzado`;
        for (let k = 1; k <= maxIter; k++) {
            const xNew = new Array(n).fill(0.0);
            for (let i = 0; i < n; i++) {
                let s = 0.0;
                for (let j = 0; j < n; j++) if (j !== i) s += A[i][j] * x[j];
                xNew[i] = (b[i] - s) / A[i][i];
            }
            if (!xNew.every(Number.isFinite) || _normInf(xNew) > 1e10) {
                iters.push({ n: k, aprox: xNew, residual: null, error_abs: null, error_rel: null });
                x = xNew; convergio = false; criterio = "divergencia detectada";
                break;
            }
            const res = _residualInf(A, xNew, b);
            const [ea, er] = _calcularErrores(xNew, xRef);
            iters.push({ n: k, aprox: [...xNew], residual: res, error_abs: ea, error_rel: er });
            const diff = xNew.map((v, i) => v - x[i]);
            x = xNew;
            if (_normInf(diff) < tol) {
                convergio = true; criterio = `||x_k - x_(k-1)||∞ < ${tol}`;
                break;
            }
        }
        return { x, iters, convergio, criterio, ms: performance.now() - t0 };
    }

    function _gaussSeidelSl(A, b, xRef, tol, maxIter) {
        const t0 = performance.now();
        const n = b.length;
        const x = new Array(n).fill(0.0);
        const iters = [];
        let convergio = false;
        let criterio = `máximo de ${maxIter} iteraciones alcanzado`;
        for (let k = 1; k <= maxIter; k++) {
            const xOld = [...x];
            for (let i = 0; i < n; i++) {
                let s1 = 0.0, s2 = 0.0;
                for (let j = 0; j < i; j++) s1 += A[i][j] * x[j];
                for (let j = i + 1; j < n; j++) s2 += A[i][j] * xOld[j];
                x[i] = (b[i] - s1 - s2) / A[i][i];
            }
            if (!x.every(Number.isFinite) || _normInf(x) > 1e10) {
                iters.push({ n: k, aprox: [...x], residual: null, error_abs: null, error_rel: null });
                convergio = false; criterio = "divergencia detectada";
                break;
            }
            const res = _residualInf(A, x, b);
            const [ea, er] = _calcularErrores(x, xRef);
            iters.push({ n: k, aprox: [...x], residual: res, error_abs: ea, error_rel: er });
            const diff = x.map((v, i) => v - xOld[i]);
            if (_normInf(diff) < tol) {
                convergio = true; criterio = `||x_k - x_(k-1)||∞ < ${tol}`;
                break;
            }
        }
        return { x, iters, convergio, criterio, ms: performance.now() - t0 };
    }

    function _cgSl(A, b, xRef, tol, maxIter) {
        const t0 = performance.now();
        const n = b.length;
        let x = new Array(n).fill(0.0);
        let r = [...b];
        let p = [...r];
        let rsOld = r.reduce((s, v) => s + v * v, 0.0);
        const iters = [];
        let convergio = false;
        let criterio = `máximo de ${maxIter} iteraciones alcanzado`;
        if (Math.sqrt(rsOld) < tol) {
            convergio = true; criterio = `||r||2 < ${tol}`;
            const [ea, er] = _calcularErrores(x, xRef);
            iters.push({ n: 1, aprox: [...x], residual: _residualInf(A, x, b), error_abs: ea, error_rel: er });
        } else {
            for (let k = 1; k <= maxIter; k++) {
                const Ap = _matVec(A, p);
                let denom = 0.0;
                for (let i = 0; i < n; i++) denom += p[i] * Ap[i];
                if (Math.abs(denom) < 1e-30) { criterio = "denominador nulo en gradiente conjugado"; break; }
                const alpha = rsOld / denom;
                x = x.map((v, i) => v + alpha * p[i]);
                r = r.map((v, i) => v - alpha * Ap[i]);
                if (!x.every(Number.isFinite) || _normInf(x) > 1e10) {
                    iters.push({ n: k, aprox: [...x], residual: null, error_abs: null, error_rel: null });
                    criterio = "divergencia detectada";
                    break;
                }
                const rsNew = r.reduce((s, v) => s + v * v, 0.0);
                const res = _residualInf(A, x, b);
                const [ea, er] = _calcularErrores(x, xRef);
                iters.push({ n: k, aprox: [...x], residual: res, error_abs: ea, error_rel: er });
                if (Math.sqrt(rsNew) < tol) {
                    convergio = true; criterio = `||r||2 < ${tol}`;
                    break;
                }
                const beta = rsNew / rsOld;
                p = r.map((v, i) => v + beta * p[i]);
                rsOld = rsNew;
            }
        }
        return { x, iters, convergio, criterio, ms: performance.now() - t0 };
    }

    function _ejecutarM2(escenario, p) {
        const sistema = String(p.sistema);
        const deltaB = Number(p.delta_b), tolSl = Number(p.tol_sl), maxIterSl = Math.round(Number(p.max_iter_sl));
        const D0 = Number(p.D0), alpha = Number(p.alpha), beta = Number(p.beta), dUmbral = Number(p.d_umbral);
        const retraso = Number(p.retraso), tolRaiz = Number(p.tol_raiz), maxIterRaiz = Math.round(Number(p.max_iter_raiz));

        const A = _construirSistemaM2(sistema);
        const xStar = [1.0, 2.0, -1.0, 1.0];
        const b0 = _matVec(A, xStar);
        const perturbVec = [1.0, -1.0, 1.0, -1.0].map(s => deltaB * s);
        const b = b0.map((v, i) => v + perturbVec[i]);

        const t0Dir = performance.now();
        const xRef = _gaussianEliminationPP(A, b);
        const msDir = performance.now() - t0Dir;
        const resDir = _residualInf(A, xRef, b);

        const t0Lu = performance.now();
        const xLu = _luDoolittle(A, b);
        const msLu = performance.now() - t0Lu;
        const resLu = _residualInf(A, xLu, b);
        const [eaLu, erLu, epLu] = _calcularErrores(xLu, xRef);

        const rJac = _jacobiSl(A, b, xRef, tolSl, maxIterSl);
        const rGs = _gaussSeidelSl(A, b, xRef, tolSl, maxIterSl);
        const rCg = _cgSl(A, b, xRef, tolSl, maxIterSl);

        const [eaJac, erJac, epJac] = (rJac.convergio || rJac.x.every(Number.isFinite)) ? _calcularErrores(rJac.x, xRef) : [null, null, null];
        const resJac = rJac.iters.length > 0 ? rJac.iters[rJac.iters.length - 1].residual : null;
        const [eaGs, erGs, epGs] = (rGs.convergio || rGs.x.every(Number.isFinite)) ? _calcularErrores(rGs.x, xRef) : [null, null, null];
        const resGs = rGs.iters.length > 0 ? rGs.iters[rGs.iters.length - 1].residual : null;
        const [eaCg, erCg, epCg] = _calcularErrores(rCg.x, xRef);
        const resCg = rCg.iters.length > 0 ? rCg.iters[rCg.iters.length - 1].residual : null;

        const eigsA = _eigvalshSimetrico(A);
        const lambdaMin = eigsA[0], lambdaMax = eigsA[eigsA.length - 1];
        const spd = lambdaMin > 0.0;
        const kappa2 = spd ? lambdaMax / lambdaMin : null;

        const dInvSqrt = A.map((row, i) => 1.0 / Math.sqrt(row[i]));
        const bSym = Array.from({ length: 4 }, (_, i) =>
            Array.from({ length: 4 }, (__, j) => (i === j ? 1.0 : 0.0) - dInvSqrt[i] * A[i][j] * dInvSqrt[j])
        );
        const eigsTJ = _eigvalshSimetrico(bSym);
        const rhoJacobi = Math.max(...eigsTJ.map(v => Math.abs(v)));

        const diagDominante = A.every((row, i) => {
            let off = 0.0;
            for (let j = 0; j < 4; j++) if (j !== i) off += Math.abs(row[j]);
            return Math.abs(row[i]) > off;
        });

        const normB0 = _norm2(b0), normDb = _norm2(perturbVec);
        const relDb2 = normB0 > 1e-14 ? normDb / normB0 : 0.0;
        const relDx2 = _norm2(xRef.map((v, i) => v - xStar[i])) / _norm2(xStar);
        const amplificacion = (deltaB > 0.0 && relDb2 > 1e-14) ? relDx2 / relDb2 : null;
        const cota = kappa2 !== null ? kappa2 * relDb2 : null;

        const tStar = _raizCuadraticaM2(D0, alpha, beta, dUmbral);
        const fDet = (t) => D0 + alpha * t + beta * t * t - dUmbral;
        const dfDet = (t) => alpha + 2.0 * beta * t;

        let U;
        if (beta < 0.0) {
            U = -alpha / (2.0 * beta);
        } else {
            U = 1.0;
            for (let k = 0; k < 60; k++) {
                if (fDet(U) > 0.0) break;
                U *= 2.0;
            }
        }

        const rBis = _resolverRaizBiseccion(fDet, 0.0, U, tolRaiz, maxIterRaiz, tStar);
        const rNew = _resolverRaizNewton(fDet, dfDet, 0.0, tolRaiz, maxIterRaiz, tStar);
        const rSec = _resolverRaizSecante(fDet, 0.0, U / 2.0, tolRaiz, maxIterRaiz, tStar);

        const [ebAbs, ebRel, ebPct] = _calcularErrores(rBis.x, tStar);
        const [enAbs, enRel, enPct] = _calcularErrores(rNew.x, tStar);
        const [esAbs, esRel, esPct] = _calcularErrores(rSec.x, tStar);

        const derivadaEnRaiz = tStar !== null ? Math.abs(dfDet(tStar)) : 0.0;
        const condRaiz = (tStar && derivadaEnRaiz > 1e-14) ? Math.abs(dUmbral) / (Math.abs(tStar) * derivadaEnRaiz) : null;
        const DRetraso = tStar !== null ? D0 + alpha * (tStar + retraso) + beta * Math.pow(tStar + retraso, 2) : null;
        const exceso = DRetraso !== null ? DRetraso - dUmbral : null;

        const sensibilidad = [];
        for (const [pname, pval] of [["D0", D0], ["alpha", alpha], ["beta", beta], ["d_umbral", dUmbral]]) {
            if (pval === 0.0) {
                sensibilidad.push({ parametro: pname, salida: "t_umbral_ref", base: tStar, perturbado: null, S: null, tipo: "relativa", nota: "parámetro nulo" });
                continue;
            }
            const kw = { D0, alpha, beta, d_umbral: dUmbral };
            kw[pname] = pval * 1.01;
            const tP = _raizCuadraticaM2(kw.D0, kw.alpha, kw.beta, kw.d_umbral);
            if (tP === null || tStar === null || Math.abs(tStar) <= 1e-14) {
                sensibilidad.push({ parametro: pname, salida: "t_umbral_ref", base: tStar, perturbado: null, S: null, tipo: "relativa", nota: "sin raíz real tras la perturbación" });
            } else {
                const SVal = ((tP - tStar) / tStar) / 0.01;
                sensibilidad.push({ parametro: pname, salida: "t_umbral_ref", base: tStar, perturbado: tP, S: SVal, tipo: "relativa", nota: null });
            }
        }

        const tMaxCurva = 1.5 * (tStar || 10.0);
        const curvaT = [], curvaD = [], curvaU = [];
        for (let i = 0; i < 100; i++) {
            const ti = tMaxCurva * i / 99.0;
            curvaT.push(ti);
            curvaD.push(D0 + alpha * ti + beta * ti * ti);
            curvaU.push(dUmbral);
        }

        const metodos = [
            {
                id: "directa", familia: "Sistemas Lineales", nombre: "Directa (Elim. Gaussiana PP)",
                tolerancia: null, paso: null, max_iter: null, convergio: true, tiempo_ms: msDir,
                criterio_parada: "eliminación gaussiana con pivoteo parcial",
                resultado: xRef, referencia: xRef, error_abs: 0.0, error_rel: 0.0, error_pct: 0.0, residual: resDir,
                iteraciones: [{ n: 1, aprox: xRef, residual: resDir, error_abs: 0.0, error_rel: 0.0 }],
                interpretacion: "Solución directa de referencia para la matriz SPD y vector b actuales."
            },
            {
                id: "lu", familia: "Sistemas Lineales", nombre: "Factorización LU (Doolittle)",
                tolerancia: null, paso: null, max_iter: null, convergio: true, tiempo_ms: msLu,
                criterio_parada: "factorización directa A = LU",
                resultado: xLu, referencia: xRef, error_abs: eaLu, error_rel: erLu, error_pct: epLu, residual: resLu,
                iteraciones: [{ n: 1, aprox: xLu, residual: resLu, error_abs: eaLu, error_rel: erLu }],
                interpretacion: `Resolución exacta en 1 factorización; error absoluto ${eaLu.toExponential(3)}.`
            },
            {
                id: "jacobi", familia: "Sistemas Lineales", nombre: "Jacobi",
                tolerancia: tolSl, paso: null, max_iter: maxIterSl, convergio: rJac.convergio, tiempo_ms: rJac.ms,
                criterio_parada: rJac.criterio, resultado: rJac.x, referencia: xRef,
                error_abs: eaJac, error_rel: erJac, error_pct: epJac, residual: resJac,
                iteraciones: _recortarIteraciones(rJac.iters, false),
                interpretacion: `Iterativo estacionario simultáneo; ρ(T_J)=${rhoJacobi.toFixed(4)} (${rJac.convergio ? "converge" : "no converge"}).`
            },
            {
                id: "gauss_seidel", familia: "Sistemas Lineales", nombre: "Gauss-Seidel",
                tolerancia: tolSl, paso: null, max_iter: maxIterSl, convergio: rGs.convergio, tiempo_ms: rGs.ms,
                criterio_parada: rGs.criterio, resultado: rGs.x, referencia: xRef,
                error_abs: eaGs, error_rel: erGs, error_pct: epGs, residual: resGs,
                iteraciones: _recortarIteraciones(rGs.iters, false),
                interpretacion: `Iterativo secuencial; garantizado en SPD aunque lento si κ₂ es alto (${rGs.iters.length} iteraciones).`
            },
            {
                id: "gradiente_conjugado", familia: "Sistemas Lineales", nombre: "Gradiente Conjugado",
                tolerancia: tolSl, paso: null, max_iter: maxIterSl, convergio: rCg.convergio, tiempo_ms: rCg.ms,
                criterio_parada: rCg.criterio, resultado: rCg.x, referencia: xRef,
                error_abs: eaCg, error_rel: erCg, error_pct: epCg, residual: resCg,
                iteraciones: _recortarIteraciones(rCg.iters, false),
                interpretacion: `Óptimo para matrices SPD: converge en ${rCg.iters.length} iteraciones (n≤4 en aritmética exacta).`
            },
            {
                id: "biseccion", familia: "Raíces", nombre: "Bisección",
                tolerancia: tolRaiz, paso: null, max_iter: maxIterRaiz, convergio: rBis.convergio, tiempo_ms: rBis.ms,
                criterio_parada: rBis.criterio, resultado: rBis.x, referencia: tStar,
                error_abs: ebAbs, error_rel: ebRel, error_pct: ebPct, residual: Math.abs(fDet(rBis.x)),
                iteraciones: _recortarIteraciones(rBis.iters, false),
                interpretacion: `Tiempo al umbral por bisección en [0, ${U.toPrecision(3)}] (${rBis.iters.length} iteraciones).`
            },
            {
                id: "newton", familia: "Raíces", nombre: "Newton-Raphson",
                tolerancia: tolRaiz, paso: null, max_iter: maxIterRaiz, convergio: rNew.convergio, tiempo_ms: rNew.ms,
                criterio_parada: rNew.criterio, resultado: rNew.x, referencia: tStar,
                error_abs: enAbs, error_rel: enRel, error_pct: enPct, residual: Math.abs(fDet(rNew.x)),
                iteraciones: _recortarIteraciones(rNew.iters, false),
                interpretacion: `Convergencia en ${rNew.iters.length} iteraciones desde t₀=0.`
            },
            {
                id: "secante", familia: "Raíces", nombre: "Secante",
                tolerancia: tolRaiz, paso: null, max_iter: maxIterRaiz, convergio: rSec.convergio, tiempo_ms: rSec.ms,
                criterio_parada: rSec.criterio, resultado: rSec.x, referencia: tStar,
                error_abs: esAbs, error_rel: esRel, error_pct: esPct, residual: Math.abs(fDet(rSec.x)),
                iteraciones: _recortarIteraciones(rSec.iters, false),
                interpretacion: `Secante en ${rSec.iters.length} iteraciones sin evaluar derivada explícita.`
            }
        ];

        const avisos = [...AVISOS_GENERALES];
        if (!rJac.convergio) {
            avisos.push(`Jacobi no converge porque ρ(T_J) = ${rhoJacobi.toFixed(4)} >= 1 (fallo de convergencia del método estacionario).`);
        }
        if (kappa2 !== null && kappa2 > 100.0) {
            avisos.push(`Matriz mal condicionada: κ₂(A) = ${kappa2.toFixed(2)}; pequeñas perturbaciones en b se amplifican en x.`);
        }

        return {
            modulo: 2, escenario, params: p, metodos,
            indicadores: {
                lambda_min: lambdaMin, lambda_max: lambdaMax, kappa2, rho_jacobi: rhoJacobi,
                diag_dominante: diagDominante, spd, rel_db2: relDb2, rel_dx2: relDx2,
                amplificacion, cota, x_star: xStar, x_ref: xRef, t_umbral_ref: tStar,
                derivada_en_raiz: derivadaEnRaiz, cond_raiz: condRaiz, D_retraso: DRetraso, exceso
            },
            sensibilidad,
            series: { t: curvaT, D: curvaD, umbral: curvaU, t_star: tStar, d_umbral: dUmbral },
            avisos
        };
    }

    // --- M3 ---
    function _m3AnaliticaEval(m, c, k, x0, v0, t) {
        const w0 = Math.sqrt(k / m);
        const zeta = c / (2.0 * Math.sqrt(m * k));
        const wd = w0 * Math.sqrt(1.0 - zeta * zeta);
        const sigma = zeta * w0;
        const env = Math.exp(-sigma * t);
        const cosT = Math.cos(wd * t);
        const sinT = Math.sin(wd * t);
        const C2x = (v0 + sigma * x0) / wd;
        const C2v = -(sigma * v0 + w0 * w0 * x0) / wd;
        return [env * (x0 * cosT + C2x * sinT), env * (v0 * cosT + C2v * sinT)];
    }

    function _m3Rk2Step(m, c, k, F0, wf, t, x, v, h) {
        const k1x = v;
        const k1v = (F0 * Math.sin(wf * t) - c * v - k * x) / m;
        const xp = x + h * k1x, vp = v + h * k1v;
        const k2x = vp;
        const k2v = (F0 * Math.sin(wf * (t + h)) - c * vp - k * xp) / m;
        return [x + 0.5 * h * (k1x + k2x), v + 0.5 * h * (k1v + k2v)];
    }

    function _m3Rk4Step(m, c, k, F0, wf, t, x, v, h) {
        const half = 0.5 * h;
        const k1x = v;
        const k1v = (F0 * Math.sin(wf * t) - c * v - k * x) / m;
        const tMid = t + half, fMid = F0 * Math.sin(wf * tMid);
        const x2 = x + half * k1x, v2 = v + half * k1v;
        const k2x = v2, k2v = (fMid - c * v2 - k * x2) / m;
        const x3 = x + half * k2x, v3 = v + half * k2v;
        const k3x = v3, k3v = (fMid - c * v3 - k * x3) / m;
        const x4 = x + h * k3x, v4 = v + h * k3v;
        const k4x = v4, k4v = (F0 * Math.sin(wf * (t + h)) - c * v4 - k * x4) / m;
        return [
            x + (h / 6.0) * (k1x + 2.0 * k2x + 2.0 * k3x + k4x),
            v + (h / 6.0) * (k1v + 2.0 * k2v + 2.0 * k3v + k4v)
        ];
    }

    function _m3IntegrarEdo(metodo, m, c, k, x0, v0, F0, wf, h, N) {
        let x = x0, v = v0;
        const xs = [x], vs = [v];
        for (let step = 0; step < N; step++) {
            const t = step * h;
            if (metodo === "rk2") [x, v] = _m3Rk2Step(m, c, k, F0, wf, t, x, v, h);
            else [x, v] = _m3Rk4Step(m, c, k, F0, wf, t, x, v, h);
            xs.push(x); vs.push(v);
        }
        return [xs, vs];
    }

    function _m3GridEnergia(m, c, k, x0, v0, F0, wf, T, M = 4096) {
        const zeta = c / (2.0 * Math.sqrt(m * k));
        const hGrid = T / M;
        const vals = new Array(M + 1).fill(0.0);
        if (F0 === 0.0 && zeta < 1.0) {
            for (let i = 0; i <= M; i++) {
                const [xi] = _m3AnaliticaEval(m, c, k, x0, v0, i * hGrid);
                vals[i] = xi * xi;
            }
        } else {
            let x = x0, v = v0;
            vals[0] = x * x;
            for (let i = 0; i < M; i++) {
                [x, v] = _m3Rk4Step(m, c, k, F0, wf, i * hGrid, x, v, hGrid);
                vals[i + 1] = x * x;
            }
        }
        return vals;
    }

    function _m3TrapGrid(vals, T, n) {
        const M = vals.length - 1, stride = Math.floor(M / n), h = T / n;
        let s = 0.5 * (vals[0] + vals[M]);
        for (let i = 1; i < n; i++) s += vals[i * stride];
        return s * h;
    }

    function _m3SimpGrid(vals, T, n) {
        const M = vals.length - 1, stride = Math.floor(M / n), h = T / n;
        let sImp = 0.0, sPar = 0.0;
        for (let i = 1; i < n; i += 2) sImp += vals[i * stride];
        for (let i = 2; i < n; i += 2) sPar += vals[i * stride];
        return (h / 3.0) * (vals[0] + 4.0 * sImp + 2.0 * sPar + vals[M]);
    }

    function _m3RombergGrid(vals, T, tol, maxNiveles = 10) {
        const t0Cpu = performance.now();
        const R = [], diagRows = [];
        let convergio = false;
        let criterio = `máximo de ${maxNiveles} niveles alcanzado`;
        for (let k = 0; k < maxNiveles; k++) {
            const nInt = 1 << k;
            const row = new Array(k + 1).fill(0.0);
            row[0] = _m3TrapGrid(vals, T, nInt);
            if (k > 0) {
                let pow4 = 4.0;
                for (let j = 1; j <= k; j++) {
                    row[j] = row[j - 1] + (row[j - 1] - R[k - 1][j - 1]) / (pow4 - 1.0);
                    pow4 *= 4.0;
                }
            }
            R.push(row);
            const res = k > 0 ? Math.abs(row[k] - R[k - 1][k - 1]) : null;
            diagRows.push({ n: k + 1, subintervalos: nInt, aprox: row[k], residual: res });
            if (k > 0 && res !== null && res < tol) {
                convergio = true;
                criterio = `|R[k,k]-R[k-1,k-1]| < ${tol}`;
                break;
            }
        }
        return { valor: R[R.length - 1][R.length - 1], diagRows, R, convergio, criterio, ms: performance.now() - t0Cpu };
    }

    function _ejecutarM3(escenario, p) {
        const m = Number(p.m), c = Number(p.c), k = Number(p.k);
        const x0 = Number(p.x0), v0 = Number(p.v0), F0 = Number(p.F0), wf = Number(p.wf);
        const T = Number(p.T), h = Number(p.h), n = Math.round(Number(p.n)), tolR = Number(p.tol_romberg);

        const N = Math.round(T / h);
        const omega0 = Math.sqrt(k / m);
        const zeta = c / (2.0 * Math.sqrt(m * k));
        const omegad = zeta < 1.0 ? omega0 * Math.sqrt(1.0 - zeta * zeta) : null;
        const hOmega0 = h * omega0;

        const refX = new Array(N + 1).fill(0.0);
        const refV = new Array(N + 1).fill(0.0);
        let tipoRef;
        if (F0 === 0.0 && zeta < 1.0) {
            tipoRef = "analítica";
            for (let i = 0; i <= N; i++) [refX[i], refV[i]] = _m3AnaliticaEval(m, c, k, x0, v0, i * h);
        } else {
            tipoRef = "numérica (RK4, h/20)";
            const hFine = h / 20.0;
            let xf = x0, vf = v0, tFine = 0.0;
            refX[0] = xf; refV[0] = vf;
            for (let i = 0; i < N; i++) {
                for (let s = 0; s < 20; s++) {
                    [xf, vf] = _m3Rk4Step(m, c, k, F0, wf, tFine, xf, vf, hFine);
                    tFine += hFine;
                }
                refX[i + 1] = xf; refV[i + 1] = vf;
            }
        }

        const t02 = performance.now();
        const [rk2X, rk2V] = _m3IntegrarEdo("rk2", m, c, k, x0, v0, F0, wf, h, N);
        const ms2 = performance.now() - t02;

        const t04 = performance.now();
        const [rk4X, rk4V] = _m3IntegrarEdo("rk4", m, c, k, x0, v0, F0, wf, h, N);
        const ms4 = performance.now() - t04;

        const [rk2Xh, rk2Vh] = _m3IntegrarEdo("rk2", m, c, k, x0, v0, F0, wf, h / 2.0, N * 2);
        const [rk4Xh, rk4Vh] = _m3IntegrarEdo("rk4", m, c, k, x0, v0, F0, wf, h / 2.0, N * 2);

        const refEnd = [refX[N], refV[N]];
        const [e2End, er2End, ep2End] = _calcularErrores([rk2X[N], rk2V[N]], refEnd);
        const [e4End, er4End, ep4End] = _calcularErrores([rk4X[N], rk4V[N]], refEnd);
        const [e2H2] = _calcularErrores([rk2Xh[rk2Xh.length - 1], rk2Vh[rk2Vh.length - 1]], refEnd);
        const [e4H2] = _calcularErrores([rk4Xh[rk4Xh.length - 1], rk4Vh[rk4Vh.length - 1]], refEnd);

        const ordenRk2 = (e2End && e2H2 && e2End > 1e-13 && e2H2 > 1e-13) ? Math.log2(e2End / e2H2) : null;
        const ordenRk4 = (e4End && e4H2 && e4End > 1e-13 && e4H2 > 1e-13) ? Math.log2(e4End / e4H2) : null;

        const ts = [], itersRk2 = [], itersRk4 = [], errsRk2 = [], errsRk4 = [];
        for (let i = 0; i <= N; i++) {
            const ti = i * h;
            ts.push(ti);
            const rVec = [refX[i], refV[i]];
            const [ea2, er2] = _calcularErrores([rk2X[i], rk2V[i]], rVec);
            const [ea4, er4] = _calcularErrores([rk4X[i], rk4V[i]], rVec);
            errsRk2.push(ea2 !== null ? ea2 : 0.0);
            errsRk4.push(ea4 !== null ? ea4 : 0.0);
            itersRk2.push({ n: i, t: ti, aprox: [rk2X[i], rk2V[i]], residual: null, error_abs: ea2, error_rel: er2 });
            itersRk4.push({ n: i, t: ti, aprox: [rk4X[i], rk4V[i]], residual: null, error_abs: ea4, error_rel: er4 });
        }

        const errMaxRk2 = Math.max(...errsRk2);
        const errMaxRk4 = Math.max(...errsRk4);
        const ampMaxRk4 = Math.max(...rk4X.map(Math.abs));
        const ampMaxRef = Math.max(...refX.map(Math.abs));

        const valsE = _m3GridEnergia(m, c, k, x0, v0, F0, wf, T, 4096);
        const ERef = _m3SimpGrid(valsE, T, 4096);

        const nsRef = [];
        let curN = 2;
        while (curN <= n) { nsRef.push(curN); curN *= 2; }

        const refinamiento = [], itersTrap = [], itersSimp = [];
        const t0Tr = performance.now();
        for (let idx = 0; idx < nsRef.length; idx++) {
            const nk = nsRef[idx];
            const vt = _m3TrapGrid(valsE, T, nk);
            const [etA, etR] = _calcularErrores(vt, ERef);
            itersTrap.push({ n: idx + 1, subintervalos: nk, aprox: vt, residual: null, error_abs: etA, error_rel: etR });
            refinamiento.push({ n: nk, trapecio: vt, err_trap: etA, simpson: 0.0, err_simp: 0.0 });
        }
        const msTr = performance.now() - t0Tr;

        const t0Sp = performance.now();
        for (let idx = 0; idx < nsRef.length; idx++) {
            const nk = nsRef[idx];
            const vsInt = _m3SimpGrid(valsE, T, nk);
            const [esA, esR] = _calcularErrores(vsInt, ERef);
            itersSimp.push({ n: idx + 1, subintervalos: nk, aprox: vsInt, residual: null, error_abs: esA, error_rel: esR });
            refinamiento[idx].simpson = vsInt;
            refinamiento[idx].err_simp = esA;
        }
        const msSp = performance.now() - t0Sp;

        const ETrap = refinamiento[refinamiento.length - 1].trapecio;
        const ESimp = refinamiento[refinamiento.length - 1].simpson;
        const [etAbs, etRel, etPct] = _calcularErrores(ETrap, ERef);
        const [esAbs, esRel, esPct] = _calcularErrores(ESimp, ERef);

        const romb = _m3RombergGrid(valsE, T, tolR);
        for (const r of romb.diagRows) {
            const [ea, er] = _calcularErrores(r.aprox, ERef);
            r.error_abs = ea; r.error_rel = er;
        }
        const [erAbs, erRel, erPct] = _calcularErrores(romb.valor, ERef);

        let ampEstacionaria = null, factorAmplificacion = null, SOmega = null;
        if (F0 > 0.0 && wf > 0.0) {
            const ampSs = (wVal) => F0 / Math.sqrt(Math.pow(k - m * wVal * wVal, 2) + Math.pow(c * wVal, 2));
            ampEstacionaria = ampSs(wf);
            factorAmplificacion = ampEstacionaria * k / F0;
            const sPlus = Math.abs(ampSs(1.01 * wf) / ampEstacionaria - 1.0);
            const sMinus = Math.abs(ampSs(0.99 * wf) / ampEstacionaria - 1.0);
            SOmega = Math.max(sPlus, sMinus) / 0.01;
        }

        const sensibilidad = [];
        const sensParams = ["c", "k"];
        if (F0 > 0.0) sensParams.push("F0");
        if (wf > 0.0) sensParams.push("wf");
        for (const pname of sensParams) {
            const kw = { m, c, k, F0, wf };
            const pval = kw[pname];
            if (pval === 0.0) {
                sensibilidad.push({ parametro: pname, salida: "amp_max_rk4", base: ampMaxRk4, perturbado: ampMaxRk4, S: null, tipo: "relativa", nota: "parámetro nulo" });
                sensibilidad.push({ parametro: pname, salida: "E_simpson", base: ESimp, perturbado: ESimp, S: null, tipo: "relativa", nota: "parámetro nulo" });
                continue;
            }
            kw[pname] = pval * 1.01;
            const [px] = _m3IntegrarEdo("rk4", kw.m, kw.c, kw.k, x0, v0, kw.F0, kw.wf, h, N);
            const ampP = Math.max(...px.map(Math.abs));
            const sAmp = Math.abs(ampMaxRk4) > 1e-14 ? ((ampP - ampMaxRk4) / ampMaxRk4) / 0.01 : null;
            sensibilidad.push({ parametro: pname, salida: "amp_max_rk4", base: ampMaxRk4, perturbado: ampP, S: sAmp, tipo: "relativa", nota: null });

            const valsP = _m3GridEnergia(kw.m, kw.c, kw.k, x0, v0, kw.F0, kw.wf, T, 4096);
            const eP = _m3SimpGrid(valsP, T, n);
            const sE = Math.abs(ESimp) > 1e-14 ? ((eP - ESimp) / ESimp) / 0.01 : null;
            sensibilidad.push({ parametro: pname, salida: "E_simpson", base: ESimp, perturbado: eP, S: sE, tipo: "relativa", nota: null });
        }

        const idxS = _submuestrearIndices(ts.length, 1000);
        const series = {
            t: idxS.map(i => ts[i]),
            rk2_x: idxS.map(i => rk2X[i]),
            rk4_x: idxS.map(i => rk4X[i]),
            ref_x: idxS.map(i => refX[i]),
            err_rk2: idxS.map(i => errsRk2[i]),
            err_rk4: idxS.map(i => errsRk4[i])
        };

        const metodos = [
            {
                id: "rk2", familia: "EDO", nombre: "RK2 (Heun)", tolerancia: null, paso: h, max_iter: null,
                convergio: true, tiempo_ms: ms2, criterio_parada: `N = ${N} pasos en [0, ${T}] s`,
                resultado: [rk2X[N], rk2V[N]], referencia: refEnd, error_abs: e2End, error_rel: er2End, error_pct: ep2End,
                residual: null, iteraciones: _recortarIteraciones(itersRk2, true),
                interpretacion: `Oscilador con Heun (O(h^2)); error máximo en la trayectoria: ${errMaxRk2.toExponential(3)}.`
            },
            {
                id: "rk4", familia: "EDO", nombre: "RK4 (Clásico)", tolerancia: null, paso: h, max_iter: null,
                convergio: true, tiempo_ms: ms4, criterio_parada: `N = ${N} pasos en [0, ${T}] s`,
                resultado: [rk4X[N], rk4V[N]], referencia: refEnd, error_abs: e4End, error_rel: er4End, error_pct: ep4End,
                residual: null, iteraciones: _recortarIteraciones(itersRk4, true),
                interpretacion: `Oscilador con RK4 (O(h^4)); error máximo en la trayectoria: ${errMaxRk4.toExponential(3)}.`
            },
            {
                id: "trapecio", familia: "Integración", nombre: "Trapecio compuesto", tolerancia: null, paso: T / n, max_iter: n,
                convergio: true, tiempo_ms: msTr, criterio_parada: `n = ${n} subintervalos`,
                resultado: ETrap, referencia: ERef, error_abs: etAbs, error_rel: etRel, error_pct: etPct,
                residual: null, iteraciones: _recortarIteraciones(itersTrap, false),
                interpretacion: `Energía vibratoria ∫x²dt con Trapecio (n=${n}).`
            },
            {
                id: "simpson", familia: "Integración", nombre: "Simpson 1/3 compuesto", tolerancia: null, paso: T / n, max_iter: n,
                convergio: true, tiempo_ms: msSp, criterio_parada: `n = ${n} subintervalos`,
                resultado: ESimp, referencia: ERef, error_abs: esAbs, error_rel: esRel, error_pct: esPct,
                residual: null, iteraciones: _recortarIteraciones(itersSimp, false),
                interpretacion: `Energía vibratoria ∫x²dt con Simpson 1/3 (n=${n}).`
            },
            {
                id: "romberg", familia: "Integración", nombre: "Romberg", tolerancia: tolR, paso: null, max_iter: 10,
                convergio: romb.convergio, tiempo_ms: romb.ms, criterio_parada: romb.criterio,
                resultado: romb.valor, referencia: ERef, error_abs: erAbs, error_rel: erRel, error_pct: erPct,
                residual: romb.diagRows[romb.diagRows.length - 1].residual, iteraciones: _recortarIteraciones(romb.diagRows, false),
                interpretacion: `Romberg en ${romb.diagRows.length} niveles (error ${erAbs.toExponential(3)}).`
            }
        ];

        const avisos = [...AVISOS_GENERALES];
        avisos.push("Nota numérica: RK2/Heun introduce amortiguamiento o amplificación numérica artificial en oscilaciones poco amortiguadas.");
        if (hOmega0 > 2.78) {
            avisos.push(`ALERTA DE ESTABILIDAD: h·ω₀ = ${hOmega0.toFixed(3)} > 2.78 (límite de estabilidad de RK4).`);
        }

        return {
            modulo: 3, escenario, params: p, metodos,
            indicadores: {
                omega0, zeta, omegad, tipo_referencia: tipoRef,
                amp_max_rk4: ampMaxRk4, amp_max_ref: ampMaxRef,
                err_max_rk2: errMaxRk2, err_max_rk4: errMaxRk4,
                orden_rk2: ordenRk2, orden_rk4: ordenRk4, h_omega0: hOmega0,
                amp_estacionaria: ampEstacionaria, factor_amplificacion: factorAmplificacion, S_omega: SOmega
            },
            sensibilidad, series, refinamiento, romberg: romb.R, avisos
        };
    }

    // --- M4 ---
    function _m4YEx(t) { return 2.0 + Math.exp(-0.2 * t) * Math.sin(t); }

    function _m4Ruido(i, sigma) {
        const raw = Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453);
        const frac = raw - Math.floor(raw);
        return sigma * Math.sqrt(3.0) * (2.0 * frac - 1.0);
    }

    function _m4Nodos(n, tFin, distribucion, sigma) {
        const tNodos = [], yNodos = [];
        for (let i = 0; i < n; i++) {
            const ti = distribucion === "chebyshev"
                ? 0.5 * tFin * (1.0 - Math.cos(Math.PI * i / (n - 1)))
                : tFin * i / (n - 1);
            tNodos.push(ti);
            yNodos.push(_m4YEx(ti) + _m4Ruido(i, sigma));
        }
        return [tNodos, yNodos];
    }

    function _lagrangeEval(xn, yn, x) {
        const n = xn.length;
        let y = 0.0;
        for (let i = 0; i < n; i++) {
            let li = 1.0;
            const xi = xn[i];
            for (let j = 0; j < n; j++) {
                if (i !== j) li *= (x - xn[j]) / (xi - xn[j]);
            }
            y += yn[i] * li;
        }
        return y;
    }

    function _newtonDdCoefs(xn, yn) {
        const n = xn.length;
        const dd = [...yn];
        for (let j = 1; j < n; j++) {
            for (let i = n - 1; i >= j; i--) {
                dd[i] = (dd[i] - dd[i - 1]) / (xn[i] - xn[i - j]);
            }
        }
        return dd;
    }

    function _newtonDdEval(xn, coefs, x) {
        const n = coefs.length;
        let val = coefs[n - 1];
        for (let i = n - 2; i >= 0; i--) val = val * (x - xn[i]) + coefs[i];
        return val;
    }

    function _splineNaturalParams(xn, yn) {
        const n = xn.length - 1;
        const h = [];
        for (let i = 0; i < n; i++) h.push(xn[i + 1] - xn[i]);
        const c = new Array(n + 1).fill(0.0);
        if (n >= 2) {
            const mSize = n - 1;
            const aSub = new Array(mSize).fill(0.0);
            const bDiag = new Array(mSize).fill(0.0);
            const cSup = new Array(mSize).fill(0.0);
            const rhs = new Array(mSize).fill(0.0);
            for (let i = 1; i < n; i++) {
                const idx = i - 1;
                aSub[idx] = h[i - 1];
                bDiag[idx] = 2.0 * (h[i - 1] + h[i]);
                cSup[idx] = h[i];
                rhs[idx] = 3.0 * ((yn[i + 1] - yn[i]) / h[i] - (yn[i] - yn[i - 1]) / h[i - 1]);
            }
            for (let idx = 1; idx < mSize; idx++) {
                const w = aSub[idx] / bDiag[idx - 1];
                bDiag[idx] -= w * cSup[idx - 1];
                rhs[idx] -= w * rhs[idx - 1];
            }
            c[n - 1] = rhs[mSize - 1] / bDiag[mSize - 1];
            for (let idx = mSize - 2; idx >= 0; idx--) {
                c[idx + 1] = (rhs[idx] - cSup[idx] * c[idx + 2]) / bDiag[idx];
            }
        }
        const bCoef = [], dCoef = [];
        for (let i = 0; i < n; i++) {
            bCoef.push((yn[i + 1] - yn[i]) / h[i] - h[i] * (c[i + 1] + 2.0 * c[i]) / 3.0);
            dCoef.push((c[i + 1] - c[i]) / (3.0 * h[i]));
        }
        return [bCoef, c, dCoef];
    }

    function _splineNaturalEval(xn, yn, bCoef, c, dCoef, x) {
        const n = xn.length - 1;
        let seg = n - 1;
        for (let i = 0; i < n; i++) {
            if (x <= xn[i + 1] || i === n - 1) { seg = i; break; }
        }
        const dx = x - xn[seg];
        return yn[seg] + bCoef[seg] * dx + c[seg] * dx * dx + dCoef[seg] * dx * dx * dx;
    }

    function _rmse(a, b) {
        let s = 0.0;
        for (let i = 0; i < a.length; i++) s += Math.pow(a[i] - b[i], 2);
        return Math.sqrt(s / a.length);
    }

    function _buscarPrimerCruce(f, tGrid, yUmbral, tol) {
        const t0Cpu = performance.now();
        const vals = tGrid.map(t => f(t) - yUmbral);
        let lo = null, hi = null;
        for (let i = 0; i < tGrid.length - 1; i++) {
            if (Math.abs(vals[i]) === 0.0) {
                const tHit = tGrid[i];
                return {
                    x: tHit,
                    iters: [{ n: 1, aprox: tHit, residual: 0.0, error_abs: null, error_rel: null, a: tHit, b: tHit }],
                    convergio: true, criterio: "cruce exacto en nodo de malla", ms: performance.now() - t0Cpu
                };
            }
            if (vals[i] * vals[i + 1] <= 0.0) { lo = tGrid[i]; hi = tGrid[i + 1]; break; }
        }
        if (lo === null || hi === null) {
            return { x: null, iters: [], convergio: false, criterio: "sin cruce del umbral", ms: performance.now() - t0Cpu };
        }
        let flo = f(lo) - yUmbral, c = lo;
        const iters = [];
        for (let k = 1; k <= 100; k++) {
            c = 0.5 * (lo + hi);
            const fc = f(c) - yUmbral;
            iters.push({ n: k, aprox: c, residual: Math.abs(fc), error_abs: null, error_rel: null, a: lo, b: hi });
            if (Math.abs(fc) < tol || 0.5 * (hi - lo) < tol) break;
            if (flo * fc <= 0.0) hi = c;
            else { lo = c; flo = fc; }
        }
        return { x: c, iters, convergio: true, criterio: `bisección con tol=${tol}`, ms: performance.now() - t0Cpu };
    }

    function _m4RmseParaSigma(nNodos, tFin, dist, sigma) {
        const [tn, yn] = _m4Nodos(nNodos, tFin, dist, sigma);
        const tEval = [], yRef = [], yLag = [];
        for (let k = 0; k <= 200; k++) {
            const tk = tFin * k / 200.0;
            tEval.push(tk);
            yRef.push(_m4YEx(tk));
            yLag.push(_lagrangeEval(tn, yn, tk));
        }
        const [bc, cc, dc] = _splineNaturalParams(tn, yn);
        const ySpl = tEval.map(t => _splineNaturalEval(tn, yn, bc, cc, dc, t));
        return [_rmse(yLag, yRef), _rmse(ySpl, yRef)];
    }

    function _ejecutarM4(escenario, p) {
        const nNodos = Math.round(Number(p.n_nodos));
        const tFin = Number(p.t_fin), dist = String(p.distribucion);
        const sigma = Number(p.sigma), yUmbral = Number(p.y_umbral);

        const [tNodos, yNodos] = _m4Nodos(nNodos, tFin, dist, sigma);
        const ocultosT = [], ocultosY = [];
        for (let i = 0; i < nNodos - 1; i++) {
            const ot = 0.5 * (tNodos[i] + tNodos[i + 1]);
            ocultosT.push(ot);
            ocultosY.push(_m4YEx(ot));
        }
        const maxOculto = Math.max(...ocultosY.map(Math.abs));

        const tEval = [], yRef = [];
        for (let k = 0; k <= 200; k++) {
            const tk = tFin * k / 200.0;
            tEval.push(tk);
            yRef.push(_m4YEx(tk));
        }

        const t0L = performance.now();
        const yLagDense = tEval.map(t => _lagrangeEval(tNodos, yNodos, t));
        const yLagOc = ocultosT.map(t => _lagrangeEval(tNodos, yNodos, t));
        const msL = performance.now() - t0L;
        const rmseLag = _rmse(yLagDense, yRef);
        const [eaLag, erLag, epLag] = _calcularErrores(yLagOc, ocultosY);
        const itLag = ocultosT.map((ot, i) => ({
            n: i + 1, t: ot, aprox: yLagOc[i], residual: null,
            error_abs: Math.abs(yLagOc[i] - ocultosY[i]),
            error_rel: maxOculto > 1e-12 ? Math.abs(yLagOc[i] - ocultosY[i]) / maxOculto : null
        }));

        const t0N = performance.now();
        const coefsDd = _newtonDdCoefs(tNodos, yNodos);
        const yNewDense = tEval.map(t => _newtonDdEval(tNodos, coefsDd, t));
        const yNewOc = ocultosT.map(t => _newtonDdEval(tNodos, coefsDd, t));
        const msN = performance.now() - t0N;
        const rmseNew = _rmse(yNewDense, yRef);
        const [eaNew, erNew, epNew] = _calcularErrores(yNewOc, ocultosY);
        const itNew = ocultosT.map((ot, i) => ({
            n: i + 1, t: ot, aprox: yNewOc[i], residual: null,
            error_abs: Math.abs(yNewOc[i] - ocultosY[i]),
            error_rel: maxOculto > 1e-12 ? Math.abs(yNewOc[i] - ocultosY[i]) / maxOculto : null
        }));

        const t0S = performance.now();
        const [bCoef, cCoef, dCoef] = _splineNaturalParams(tNodos, yNodos);
        const ySplDense = tEval.map(t => _splineNaturalEval(tNodos, yNodos, bCoef, cCoef, dCoef, t));
        const ySplOc = ocultosT.map(t => _splineNaturalEval(tNodos, yNodos, bCoef, cCoef, dCoef, t));
        const msS = performance.now() - t0S;
        const rmseSpl = _rmse(ySplDense, yRef);
        const [eaSpl, erSpl, epSpl] = _calcularErrores(ySplOc, ocultosY);
        const itSpl = ocultosT.map((ot, i) => ({
            n: i + 1, t: ot, aprox: ySplOc[i], residual: null,
            error_abs: Math.abs(ySplOc[i] - ocultosY[i]),
            error_rel: maxOculto > 1e-12 ? Math.abs(ySplOc[i] - ocultosY[i]) / maxOculto : null
        }));

        const rCruceRef = _buscarPrimerCruce(_m4YEx, tEval, yUmbral, 1e-13);
        const rCruce = _buscarPrimerCruce(t => _splineNaturalEval(tNodos, yNodos, bCoef, cCoef, dCoef, t), tEval, yUmbral, 1e-10);
        let ecAbs = null, ecRel = null, ecPct = null;
        if (rCruce.convergio && rCruceRef.x !== null && rCruce.x !== null) {
            for (const row of rCruce.iters) {
                const [ea, er] = _calcularErrores(row.aprox, rCruceRef.x);
                row.error_abs = ea; row.error_rel = er;
            }
            [ecAbs, ecRel, ecPct] = _calcularErrores(rCruce.x, rCruceRef.x);
        }

        let lebesgue = 0.0;
        for (let k = 0; k <= 1000; k++) {
            const tk = tFin * k / 1000.0;
            let sAbs = 0.0;
            for (let i = 0; i < nNodos; i++) {
                let li = 1.0;
                const xi = tNodos[i];
                for (let j = 0; j < nNodos; j++) if (i !== j) li *= (tk - tNodos[j]) / (xi - tNodos[j]);
                sAbs += Math.abs(li);
            }
            if (sAbs > lebesgue) lebesgue = sAbs;
        }

        let maxDifLagNewton = 0.0;
        for (let i = 0; i < yLagDense.length; i++) {
            const d = Math.abs(yLagDense[i] - yNewDense[i]);
            if (d > maxDifLagNewton) maxDifLagNewton = d;
        }

        const [rmseLagP, rmseSplP] = _m4RmseParaSigma(nNodos, tFin, dist, sigma + 0.01);
        const sensibilidad = [
            { parametro: "sigma", salida: "rmse_lag", base: rmseLag, perturbado: rmseLagP, S: (rmseLagP - rmseLag) / 0.01, tipo: "absoluta", nota: null },
            { parametro: "sigma", salida: "rmse_spl", base: rmseSpl, perturbado: rmseSplP, S: (rmseSplP - rmseSpl) / 0.01, tipo: "absoluta", nota: null }
        ];

        const errLag = yLagDense.map((v, i) => Math.abs(v - yRef[i]));
        const errNew = yNewDense.map((v, i) => Math.abs(v - yRef[i]));
        const errSpl = ySplDense.map((v, i) => Math.abs(v - yRef[i]));

        const resCruce = (rCruce.convergio && rCruce.x !== null)
            ? Math.abs(_splineNaturalEval(tNodos, yNodos, bCoef, cCoef, dCoef, rCruce.x) - yUmbral)
            : null;

        const metodos = [
            {
                id: "lagrange", familia: "Interpolación", nombre: "Lagrange",
                tolerancia: null, paso: null, max_iter: null, convergio: true, tiempo_ms: msL,
                criterio_parada: `polinomio único de grado ${nNodos - 1}`,
                resultado: yLagOc, referencia: ocultosY, error_abs: eaLag, error_rel: erLag, error_pct: epLag,
                residual: rmseLag, iteraciones: _recortarIteraciones(itLag, false),
                interpretacion: `Error máximo en puntos ocultados: ${eaLag.toExponential(3)}; RMSE global: ${rmseLag.toExponential(3)}.`
            },
            {
                id: "newton_dd", familia: "Interpolación", nombre: "Newton (Dif. Divididas)",
                tolerancia: null, paso: null, max_iter: null, convergio: true, tiempo_ms: msN,
                criterio_parada: `polinomio único de grado ${nNodos - 1}`,
                resultado: yNewOc, referencia: ocultosY, error_abs: eaNew, error_rel: erNew, error_pct: epNew,
                residual: rmseNew, iteraciones: _recortarIteraciones(itNew, false),
                interpretacion: `Matemáticamente idéntico a Lagrange (dif. máx. ${maxDifLagNewton.toExponential(2)}); RMSE: ${rmseNew.toExponential(3)}.`
            },
            {
                id: "spline_natural", familia: "Interpolación", nombre: "Splines Cúbicos Naturales",
                tolerancia: null, paso: null, max_iter: null, convergio: true, tiempo_ms: msS,
                criterio_parada: "sistema tridiagonal (Thomas)",
                resultado: ySplOc, referencia: ocultosY, error_abs: eaSpl, error_rel: erSpl, error_pct: epSpl,
                residual: rmseSpl, iteraciones: _recortarIteraciones(itSpl, false),
                interpretacion: `Interpolación cúbica por tramos sin oscilación de Runge; RMSE: ${rmseSpl.toExponential(3)}.`
            },
            {
                id: "biseccion_cruce", familia: "Raíces", nombre: "Bisección (Cruce de Umbral)",
                tolerancia: 1e-10, paso: null, max_iter: 100, convergio: rCruce.convergio, tiempo_ms: rCruce.ms,
                criterio_parada: rCruce.criterio,
                resultado: rCruce.x, referencia: rCruceRef.convergio ? rCruceRef.x : null,
                error_abs: ecAbs, error_rel: ecRel, error_pct: ecPct, residual: resCruce,
                iteraciones: _recortarIteraciones(rCruce.iters, false),
                interpretacion: (rCruce.convergio && rCruce.x !== null)
                    ? `Primer cruce con y=${yUmbral} en t=${rCruce.x.toFixed(5)} s.`
                    : `No se detectó cruce con el umbral y=${yUmbral}.`
            }
        ];

        const avisos = [...AVISOS_GENERALES];
        if (lebesgue > 100.0) {
            avisos.push(`Fenómeno de Runge severo: constante de Lebesgue Λ = ${lebesgue.toFixed(2)} amplifica errores y ruido en nodos equiespaciados.`);
        }

        return {
            modulo: 4, escenario, params: p, metodos,
            indicadores: {
                lebesgue, rmse_lag: rmseLag, rmse_new: rmseNew, rmse_spl: rmseSpl,
                max_dif_lag_newton: maxDifLagNewton, newton_coefs: coefsDd
            },
            sensibilidad,
            series: {
                t: tEval, ref: yRef, lag: yLagDense, newton: yNewDense, spline: ySplDense,
                nodos_t: tNodos, nodos_y: yNodos, ocultos_t: ocultosT, ocultos_y: ocultosY,
                err_lag: errLag, err_new: errNew, err_spl: errSpl
            },
            avisos
        };
    }

    function ejecutar(modulo, escenario, params = null) {
        const mod = Number(modulo);
        if (!Number.isInteger(mod) || !PRESETS[mod]) throw new Error("Módulo inválido.");
        if (!PRESETS[mod][escenario]) throw new Error("Escenario inválido (NORMAL, ESTRES o MAL_CONDICIONADO).");
        const p = _coercerParams(mod, escenario, params);
        const errores = validar(mod, p);
        if (errores.length > 0) throw new Error(errores.join("; "));
        if (mod === 1) return _ejecutarM1(escenario, p);
        if (mod === 2) return _ejecutarM2(escenario, p);
        if (mod === 3) return _ejecutarM3(escenario, p);
        return _ejecutarM4(escenario, p);
    }

    const Motor = { PRESETS, AVISOS_GENERALES, validar, ejecutar };
    if (typeof module !== "undefined" && module.exports) {
        module.exports = Motor;
    } else {
        root.MotorSIMTELE = Motor;
    }
})(typeof window !== "undefined" ? window : globalThis);
