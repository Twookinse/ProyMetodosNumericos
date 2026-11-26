/* Interfaz SIMTELE-RISK (Semana 3).
 * Maneja modo servidor (Flask + SQLite) y modo local autónomo (MotorSIMTELE + localStorage),
 * formularios con validación, gráficos Chart.js, tablas de error/iteraciones/sensibilidad,
 * conclusiones dobles, comparación 12x e historial con Abrir y Relanzar.
 */
(function (root) {
    "use strict";

    const LS_KEY = "simtele_hist_v3";
    const MAX_LS = 40;
    const SUPABASE_URL = "https://wuxfarmwyuklxmspepei.supabase.co";
    const SUPABASE_KEY = "sb_publishable_Xx2A6rAlVmHMgWHSw6Gwlg_85NELjDG";
    let modoActual = "detectando"; // "servidor" | "supabase" | "local"
    const charts = {};
    const ultimosResultados = {};
    const estadoRecuperacion = {};

    const ESCENARIOS_LABEL = {
        NORMAL: "NORMAL",
        ESTRES: "ESTRÉS",
        MAL_CONDICIONADO: "MAL CONDICIONADO"
    };

    const MODULO_CONFIG = {
        1: {
            titulo: "Módulo 1: Detención de Emergencia de Cabinas",
            badgeColor: "text-red-600",
            btnClass: "bg-red-600 hover:bg-red-700",
            pregunta: "¿Cómo varían el tiempo y la distancia de detención frente a cambios en la velocidad de línea, tiempo de reacción y ley de desaceleración?",
            ecuaciones: [
                "dx/dt = v(t),   dv/dt = -(a₀ + b·v(t)),   x(0) = 0, v(0) = v₀",
                "t_total = t_r + t_det,   d_total = v₀·t_r + ∫₀^{t_det} v(t) dt",
                "f(t) = v(t) [simple]  ó  f(t) = v(t)·|v(t)| [doble, f'(t*)=0]"
            ],
            escenariosDesc: {
                NORMAL: "Parámetros nominales (v₀=6.0 m/s, a₀=1.5 m/s², b=0.05 s⁻¹, h=0.10 s, n=16). Distancia total por debajo del límite de 25 m.",
                ESTRES: "Sobrecarga y freno degradado (v₀=8.5 m/s, a₀=0.75 m/s², t_r=1.0 s, h=0.50 s, n=4). Exige mayor distancia (> 25 m) y paso grueso.",
                MAL_CONDICIONADO: "Raíz múltiple tangencial f(t)=v·|v| con derivada nula f'(t*)=0. Evalúa pérdida de convergencia cuadrática en Newton frente a Bisección."
            },
            paramsMeta: [
                { key: "v0", label: "Velocidad inicial v₀", unit: "m/s", type: "number", step: "any", fuente: "Sintético" },
                { key: "a0", label: "Desaceleración base a₀", unit: "m/s²", type: "number", step: "any", fuente: "Sintético" },
                { key: "b", label: "Coef. disipación b", unit: "1/s", type: "number", step: "any", fuente: "Supuesto" },
                { key: "t_r", label: "Tiempo de reacción t_r", unit: "s", type: "number", step: "any", fuente: "Supuesto" },
                { key: "d_disp", label: "Distancia disponible d_disp", unit: "m", type: "number", step: "any", fuente: "Supuesto" },
                { key: "h", label: "Paso temporal EDO h", unit: "s", type: "number", step: "any", fuente: "Numérico" },
                { key: "n", label: "Subintervalos integración n", unit: "par", type: "number", step: "2", fuente: "Numérico" },
                { key: "tol", label: "Tolerancia raíces/Romberg", unit: "—", type: "number", step: "any", fuente: "Numérico" },
                { key: "max_iter", label: "Máx. iteraciones raíces", unit: "iter", type: "number", step: "1", fuente: "Numérico" },
                { key: "formulacion", label: "Formulación raíz f(t)", unit: "—", type: "select", options: [["simple", "simple: v(t)"], ["doble", "doble: v(t)|v(t)|"]], fuente: "Modelo" }
            ],
            charts: [
                { id: "c-m1-vel", titulo: "1. Velocidad v(t): RK2 vs RK4 vs Referencia" },
                { id: "c-m1-err", titulo: "2. Error EDO Log10(||e(t)||∞) vs Tiempo" },
                { id: "c-m1-raiz", titulo: "3. Convergencia de Raíces Log10(|t_k - t*|)" },
                { id: "c-m1-int", titulo: "4. Refinamiento Integración Log10(Error) vs n" }
            ]
        },
        2: {
            titulo: "Módulo 2: Deterioro Mecánico y Mantenimiento Predictivo",
            badgeColor: "text-blue-600",
            btnClass: "bg-blue-600 hover:bg-blue-700",
            pregunta: "¿En qué instante t* alcanza el indicador D(t) el umbral normativo de inspección y cómo afecta el condicionamiento del sistema lineal SPD 4×4?",
            ecuaciones: [
                "Calibración SPD 4×4: A·x = b,   x* = [1.20? -> ref: 1, 2, -1, 1]ᵀ",
                "Progresión deterioro: D(t) = D₀ + α·t + β·t²,   f(t) = D(t) - D_umbral = 0",
                "Cota de perturbación: ||δx||₂/||x*||₂ ≤ κ₂(A)·(||δb||₂/||b₀||₂)"
            ],
            escenariosDesc: {
                NORMAL: "Matriz SPD diagonal dominante (κ₂ ≈ 2.36) sin perturbación Δb y raíz bien condicionada para D(t) = 75 %.",
                ESTRES: "Perturbación Δb = 0.05 y tolerancia estricta 1e-10; aumento de α=6.0, β=1.2 y retraso de 2.0 kh para cuantificar impacto.",
                MAL_CONDICIONADO: "Matriz de Hilbert regularizada (κ₂ ≈ 7627, ρ(T_J) > 1) + umbral casi tangente D_umbral = 41.9999 cerca del máximo de D(t)."
            },
            paramsMeta: [
                { key: "sistema", label: "Matriz del sistema A", unit: "4×4 SPD", type: "select", options: [["base", "base (diag. dom.)"], ["hilbert", "hilbert (+1e-4·I)"]], fuente: "Sintético" },
                { key: "delta_b", label: "Perturbación Δb", unit: "—", type: "number", step: "any", fuente: "Supuesto" },
                { key: "tol_sl", label: "Tolerancia sist. lineales", unit: "—", type: "number", step: "any", fuente: "Numérico" },
                { key: "max_iter_sl", label: "Máx. iter. sist. lineales", unit: "iter", type: "number", step: "1", fuente: "Numérico" },
                { key: "D0", label: "Deterioro inicial D₀", unit: "%", type: "number", step: "any", fuente: "Sintético" },
                { key: "alpha", label: "Tasa lineal α", unit: "%/kh", type: "number", step: "any", fuente: "Sintético" },
                { key: "beta", label: "Término cuadrático β", unit: "%/kh²", type: "number", step: "any", fuente: "Supuesto" },
                { key: "d_umbral", label: "Umbral D_umbral", unit: "%", type: "number", step: "any", fuente: "Normativo sup." },
                { key: "retraso", label: "Retraso mantenimiento", unit: "kh", type: "number", step: "any", fuente: "Supuesto" },
                { key: "tol_raiz", label: "Tolerancia raíces", unit: "—", type: "number", step: "any", fuente: "Numérico" },
                { key: "max_iter_raiz", label: "Máx. iteraciones raíces", unit: "iter", type: "number", step: "1", fuente: "Numérico" }
            ],
            charts: [
                { id: "c-m2-sl", titulo: "1. Convergencia Sistemas Lineales Log10(Error Abs.)" },
                { id: "c-m2-raiz", titulo: "2. Convergencia Raíces Log10(|f(t_k)|)" },
                { id: "c-m2-curva", titulo: "3. Curva de Deterioro D(t) y Umbral de Inspección" }
            ]
        },
        3: {
            titulo: "Módulo 3: Oscilaciones Laterales por Viento",
            badgeColor: "text-amber-600",
            btnClass: "bg-amber-600 hover:bg-amber-700",
            pregunta: "¿Cómo varían la trayectoria oscilatoria y la energía vibratoria ∫x²dt ante ráfagas armónicas, bajo amortiguamiento y cuasi-resonancia?",
            ecuaciones: [
                "x'(t) = v(t),   v'(t) = (F₀·sin(ω_f·t) - c·v(t) - k·x(t)) / m",
                "ω₀ = √(k/m),   ζ = c / (2√(mk)),   E(T) = ∫₀^T [x(t)]² dt"
            ],
            escenariosDesc: {
                NORMAL: "Oscilación libre subamortiguada (F₀=0, c=320, ζ≈0.158) con referencia analítica cerrada en t ∈ [0, 10] s.",
                ESTRES: "Forzamiento armónico F₀=200 N, ω_f=1.2 rad/s, horizonte T=40 s, amortiguamiento reducido c=80 y paso grueso h=0.25 s.",
                MAL_CONDICIONADO: "Cuasi-resonancia (ω_f ≈ ω₀ = 1.264911 rad/s, c=8 N·s/m, ζ≈0.004) con amplificación dinámica extrema > 50×."
            },
            paramsMeta: [
                { key: "m", label: "Masa efectiva m", unit: "kg", type: "number", step: "any", fuente: "Sintético" },
                { key: "c", label: "Amortiguamiento c", unit: "N·s/m", type: "number", step: "any", fuente: "Supuesto" },
                { key: "k", label: "Rigidez k", unit: "N/m", type: "number", step: "any", fuente: "Sintético" },
                { key: "x0", label: "Desplazamiento inicial x₀", unit: "m", type: "number", step: "any", fuente: "Sintético" },
                { key: "v0", label: "Velocidad inicial v₀", unit: "m/s", type: "number", step: "any", fuente: "Sintético" },
                { key: "F0", label: "Amplitud fuerza F₀", unit: "N", type: "number", step: "any", fuente: "Supuesto" },
                { key: "wf", label: "Frecuencia excitación ω_f", unit: "rad/s", type: "number", step: "any", fuente: "Supuesto" },
                { key: "T", label: "Horizonte T", unit: "s", type: "number", step: "any", fuente: "Numérico" },
                { key: "h", label: "Paso temporal h", unit: "s", type: "number", step: "any", fuente: "Numérico" },
                { key: "n", label: "Subintervalos n (2^k)", unit: "pot. 2", type: "number", step: "1", fuente: "Numérico" },
                { key: "tol_romberg", label: "Tolerancia Romberg", unit: "—", type: "number", step: "any", fuente: "Numérico" }
            ],
            charts: [
                { id: "c-m3-osc", titulo: "1. Trayectoria x(t): RK2 vs RK4 vs Referencia" },
                { id: "c-m3-err", titulo: "2. Error EDO Log10(||e(t)||∞) vs Tiempo" },
                { id: "c-m3-int", titulo: "3. Refinamiento Energía ∫x²dt Log10(Error) vs n" }
            ]
        },
        4: {
            titulo: "Módulo 4: Reconstrucción de Señales de Sensores",
            badgeColor: "text-purple-600",
            btnClass: "bg-purple-600 hover:bg-purple-700",
            pregunta: "¿Cómo afecta la distribución de nodos, el ruido de medición y el grado polinómico al error de reconstrucción y cruce de umbral?",
            ecuaciones: [
                "Señal sintética de referencia: y_ex(t) = 2 + e^(-0.2t)·sin(t)",
                "Interpolantes P(t): Lagrange ≡ Newton (Dif. Divididas) vs Splines Cúbicos Naturales",
                "Validación en puntos medios ocultados y primer cruce P_spline(t) - y_umbral = 0"
            ],
            escenariosDesc: {
                NORMAL: "7 nodos equiespaciados en [0, 6] s sin ruido (σ=0). Coincidencia suave entre Lagrange, Newton y Splines.",
                ESTRES: "7 nodos con ruido determinista equivalente σ=0.05. Evalúa propagación del ruido en interpolación y cruce de umbral.",
                MAL_CONDICIONADO: "21 nodos equiespaciados en [0, 12] s con σ=0.01: fenómeno de Runge severo (Λ > 100) frente a estabilidad de Splines o Chebyshev."
            },
            paramsMeta: [
                { key: "n_nodos", label: "Número de nodos", unit: "3..30", type: "number", step: "1", fuente: "Numérico" },
                { key: "t_fin", label: "Tiempo final t_fin", unit: "s", type: "number", step: "any", fuente: "Sintético" },
                { key: "distribucion", label: "Distribución de nodos", unit: "—", type: "select", options: [["equiespaciados", "equiespaciados"], ["chebyshev", "chebyshev"]], fuente: "Numérico" },
                { key: "sigma", label: "Nivel de ruido σ", unit: "—", type: "number", step: "any", fuente: "Supuesto" },
                { key: "y_umbral", label: "Umbral de alerta y_umbral", unit: "u.", type: "number", step: "any", fuente: "Normativo sup." }
            ],
            charts: [
                { id: "c-m4-curvas", titulo: "1. Curvas Superpuestas, Nodos y Puntos Ocultados" },
                { id: "c-m4-err", titulo: "2. Error Puntual Log10(|P(t) - y_ref(t)|)" },
                { id: "c-m4-rmse", titulo: "3. Comparación RMSE Global" }
            ]
        }
    };

    MODULO_CONFIG[2].ecuaciones[0] = "Calibración SPD 4×4: A·x = b,   x* = [1, 2, -1, 1]ᵀ";

    // --- FORMATEO ---
    function fmtNum(val, dec = 4) {
        if (val === null || val === undefined || Number.isNaN(val)) return "N/A";
        const num = Number(val);
        if (!Number.isFinite(num)) return "N/A";
        if (num === 0) return "0";
        const abs = Math.abs(num);
        if (abs < 1e-3 || abs >= 1e5) return num.toExponential(3);
        return num.toFixed(dec);
    }

    function fmtRes(val) {
        if (val === null || val === undefined) return "N/A";
        if (Array.isArray(val)) return "[" + val.map(v => fmtNum(v, 4)).join(", ") + "]";
        return fmtNum(val, 5);
    }

    function fmtPct(val) {
        if (val === null || val === undefined || !Number.isFinite(Number(val))) return "N/A";
        return fmtNum(val, 4) + " %";
    }

    function logSafe(val) {
        const num = Number(val);
        if (!Number.isFinite(num)) return -16;
        return Math.log10(Math.max(num, 1e-16));
    }

    function destroyChart(id) {
        if (charts[id]) {
            charts[id].destroy();
            delete charts[id];
        }
    }

    function escHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // --- MODO SERVIDOR / SUPABASE / LOCAL ---
    function actualizarBadgeModo(modo) {
        const badge = document.getElementById("badge-modo");
        if (!badge) return;
        if (modo === "servidor") {
            badge.innerText = "Modo: Servidor (Python + SQLite)";
            badge.className = "text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-800 text-emerald-100 border border-emerald-600";
        } else if (modo === "supabase") {
            badge.innerText = "Modo: GitHub Pages (JS + Supabase)";
            badge.className = "text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-teal-800 text-teal-100 border border-teal-500";
        } else {
            badge.innerText = "Modo: Local (JS + localStorage)";
            badge.className = "text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-800 text-amber-100 border border-amber-600";
        }
    }

    async function detectarModo() {
        try {
            const r = await fetch("api/estado", { cache: "no-store" });
            if (!r.ok) throw new Error("HTTP " + r.status);
            await r.json();
            modoActual = "servidor";
            actualizarBadgeModo("servidor");
            return modoActual;
        } catch (_e) {
            try {
                const rSupa = await fetch(`${SUPABASE_URL}/rest/v1/caso_estudio?select=id&limit=1`, {
                    headers: { apikey: SUPABASE_KEY },
                    cache: "no-store"
                });
                if (!rSupa.ok) throw new Error("Supabase HTTP " + rSupa.status);
                modoActual = "supabase";
                actualizarBadgeModo("supabase");
                return modoActual;
            } catch (_e2) {
                modoActual = "local";
                actualizarBadgeModo("local");
                return modoActual;
            }
        }
    }

    async function guardarEnSupabase(mod, escenario, res) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/guardar_simulacion_completa`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: SUPABASE_KEY
            },
            body: JSON.stringify({
                p_caso_id: Number(mod),
                p_tipo: escenario,
                p_parametros: res.params,
                p_snapshot: res
            })
        });
        if (!r.ok) throw new Error("Supabase RPC HTTP " + r.status);
        return await r.json();
    }

    function leerLocalStorage() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return [];
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (_e) {
            return [];
        }
    }

    function guardarLocalStorage(mod, escenario, res) {
        const lista = leerLocalStorage();
        const nextId = lista.reduce((mx, r) => Math.max(mx, r.sim_id || 0), 0) + 1;
        const fecha = new Date().toISOString().replace("T", " ").substring(0, 19);
        const reg = {
            sim_id: nextId,
            fecha,
            modulo: mod,
            caso: MODULO_CONFIG[mod].titulo,
            tipo: escenario,
            estado: "COMPLETADO",
            tiene_snapshot: true,
            params: res.params,
            snapshot: res
        };
        lista.unshift(reg);
        localStorage.setItem(LS_KEY, JSON.stringify(lista.slice(0, MAX_LS)));
        return nextId;
    }

    async function apiEjecutar(mod, escenario, params, guardar) {
        if (modoActual === "detectando") await detectarModo();

        if (modoActual === "servidor") {
            let res;
            try {
                res = await fetch(`api/ejecutar/${mod}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ escenario, params, guardar })
                });
            } catch (_netErr) {
                await detectarModo();
                const dataLocal = root.MotorSIMTELE.ejecutar(mod, escenario, params);
                if (guardar) {
                    if (modoActual === "supabase") {
                        try { dataLocal.sim_id = await guardarEnSupabase(mod, escenario, dataLocal); }
                        catch (_e) { dataLocal.sim_id = guardarLocalStorage(mod, escenario, dataLocal); }
                    } else {
                        dataLocal.sim_id = guardarLocalStorage(mod, escenario, dataLocal);
                    }
                }
                return dataLocal;
            }

            if (res.status === 400) {
                const errJson = await res.json();
                const err = new Error("VALIDACION");
                err.errores = errJson.errores || ["Parámetros inválidos."];
                throw err;
            }
            if (!res.ok) throw new Error("Error HTTP " + res.status);
            return await res.json();
        }

        const dataLocal = root.MotorSIMTELE.ejecutar(mod, escenario, params);
        if (guardar) {
            if (modoActual === "supabase") {
                try {
                    dataLocal.sim_id = await guardarEnSupabase(mod, escenario, dataLocal);
                } catch (_e) {
                    dataLocal.sim_id = guardarLocalStorage(mod, escenario, dataLocal);
                }
            } else {
                dataLocal.sim_id = guardarLocalStorage(mod, escenario, dataLocal);
            }
        }
        return dataLocal;
    }

    // --- NAVEGACIÓN ---
    function mostrarVista(vista) {
        ["inicio", "modulo1", "modulo2", "modulo3", "modulo4", "comparacion", "der", "historial"].forEach(v => {
            const el = document.getElementById("vista-" + v);
            if (el) el.classList.add("hidden");
        });
        const target = document.getElementById("vista-" + vista);
        if (target) target.classList.remove("hidden");
    }

    function construirEsqueletoModulo(mod) {
        const sec = document.getElementById(`vista-modulo${mod}`);
        if (sec.dataset.built === "1") return;
        const cfg = MODULO_CONFIG[mod];

        const paramsInputs = cfg.paramsMeta.map(pm => {
            const id = `m${mod}-p-${pm.key}`;
            let ctrl;
            if (pm.type === "select") {
                const opts = pm.options.map(([v, txt]) => `<option value="${v}">${txt}</option>`).join("");
                ctrl = `<select id="${id}" onchange="AppUI.onParamChange(${mod})" class="w-full border border-slate-300 rounded px-2 py-1 text-xs bg-white">${opts}</select>`;
            } else {
                ctrl = `<input id="${id}" type="number" step="${pm.step}" oninput="AppUI.onParamChange(${mod})" class="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono">`;
            }
            return `<div>
                <label for="${id}" class="block text-[11px] font-semibold text-slate-700 mb-0.5">${pm.label} <span class="text-slate-400">(${pm.unit})</span></label>
                ${ctrl}
            </div>`;
        }).join("");

        const tablaMeta = cfg.paramsMeta.map(pm =>
            `<tr><td class="p-1.5 font-mono font-semibold">${pm.key}</td><td class="p-1.5">${pm.label}</td><td class="p-1.5">${pm.unit}</td><td class="p-1.5 text-slate-500">${pm.fuente}</td></tr>`
        ).join("");

        const chartsHtml = cfg.charts.map(c =>
            `<div class="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                <h4 class="text-xs sm:text-sm font-bold text-slate-700 mb-2">${c.titulo}</h4>
                <div class="relative h-64"><canvas id="${c.id}"></canvas></div>
            </div>`
        ).join("");

        sec.innerHTML = `
            <!-- Banners recuperación / reproducibilidad -->
            <div id="m${mod}-banner-recuperada" class="hidden bg-indigo-50 border border-indigo-300 text-indigo-900 px-4 py-2.5 rounded-lg text-sm flex flex-wrap justify-between items-center gap-2">
                <span id="m${mod}-banner-texto" class="font-semibold"></span>
                <button onclick="AppUI.limpiarBanner(${mod})" class="text-xs underline">Cerrar aviso</button>
            </div>
            <div id="m${mod}-repro-box" class="hidden bg-emerald-50 border border-emerald-300 rounded-lg p-4 space-y-2"></div>

            <!-- 1. Controles principales -->
            <div class="bg-white p-5 rounded-lg shadow-sm border border-slate-200 flex flex-wrap justify-between items-center gap-4">
                <div>
                    <span class="text-xs font-bold uppercase ${cfg.badgeColor}">Módulo ${mod}</span>
                    <h2 class="text-lg font-bold text-slate-900">${cfg.titulo}</h2>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <select id="m${mod}-escenario" onchange="AppUI.onEscenarioChange(${mod})"
                        class="border border-slate-300 rounded px-3 py-1.5 text-sm font-medium bg-white">
                        <option value="NORMAL">NORMAL</option>
                        <option value="ESTRES">ESTRÉS</option>
                        <option value="MAL_CONDICIONADO">MAL CONDICIONADO</option>
                    </select>
                    <button id="m${mod}-btn-ejecutar" onclick="AppUI.ejecutarModulo(${mod})"
                        class="${cfg.btnClass} text-white px-4 py-1.5 rounded text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                        Ejecutar y Guardar
                    </button>
                    <button onclick="AppUI.compararTresEscenarios(${mod})"
                        class="bg-slate-700 hover:bg-slate-800 text-white px-3 py-1.5 rounded text-sm font-semibold">
                        Comparar 3 escenarios
                    </button>
                </div>
            </div>

            <!-- 2. Modelo y supuestos -->
            <details class="bg-white rounded-lg shadow-sm border border-slate-200" open>
                <summary class="px-5 py-3 cursor-pointer text-sm font-bold text-slate-800 bg-slate-50 rounded-t-lg border-b border-slate-200">
                    Modelo Matemático, Variables, Unidades y Descripción del Escenario
                </summary>
                <div class="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                    <div class="space-y-2">
                        <p><strong>Pregunta:</strong> ${cfg.pregunta}</p>
                        <div class="bg-slate-900 text-slate-100 p-3 rounded font-mono space-y-1">
                            ${cfg.ecuaciones.map(eq => `<div>${eq}</div>`).join("")}
                        </div>
                        <div class="bg-blue-50 border border-blue-200 p-2.5 rounded text-blue-950">
                            <strong>Escenario (<span id="m${mod}-esc-nombre">NORMAL</span>):</strong>
                            <span id="m${mod}-esc-desc">${cfg.escenariosDesc.NORMAL}</span>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse">
                            <thead><tr class="bg-slate-100 border-b"><th class="p-1.5">Símbolo</th><th class="p-1.5">Descripción</th><th class="p-1.5">Unidad</th><th class="p-1.5">Fuente</th></tr></thead>
                            <tbody class="divide-y divide-slate-200">${tablaMeta}</tbody>
                        </table>
                    </div>
                </div>
            </details>

            <!-- 3. Formulario de parámetros con validación -->
            <div class="bg-white p-5 rounded-lg shadow-sm border border-slate-200 space-y-3">
                <div class="flex justify-between items-center">
                    <h3 class="text-sm font-bold text-slate-800">Parámetros Editables</h3>
                    <button onclick="AppUI.cargarPresetEnFormulario(${mod})" class="text-xs text-blue-600 hover:underline font-semibold">Restaurar preset del escenario</button>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">${paramsInputs}</div>
                <div id="m${mod}-errores-val" class="hidden bg-red-50 border border-red-300 text-red-800 p-3 rounded text-xs space-y-1"></div>
            </div>

            <!-- 4. Indicadores -->
            <div id="m${mod}-indicadores" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>

            <!-- 5. Gráficos -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">${chartsHtml}</div>

            <!-- 6. Tabla comparativa de métodos -->
            <div class="bg-white p-5 rounded-lg shadow-sm border border-slate-200 space-y-2 overflow-x-auto">
                <h3 class="text-sm font-bold text-slate-800">Tabla Comparativa de Métodos y Teoría de Errores Transversal</h3>
                <table class="w-full text-left border-collapse text-xs">
                    <thead>
                        <tr class="bg-slate-100 border-b border-slate-300">
                            <th class="p-2">Familia</th><th class="p-2">Método</th><th class="p-2">Resultado</th>
                            <th class="p-2">Referencia</th><th class="p-2">Error Abs.</th><th class="p-2">Error Rel.</th>
                            <th class="p-2">Error %</th><th class="p-2">Residuo</th><th class="p-2">Iter.</th>
                            <th class="p-2">Conv.</th><th class="p-2">Criterio de Parada</th><th class="p-2">Tiempo (ms)</th>
                        </tr>
                    </thead>
                    <tbody id="m${mod}-tabla-metodos" class="divide-y divide-slate-200 font-mono"></tbody>
                </table>
            </div>

            <!-- 7. Iteraciones, Refinamiento / Romberg / Newton DD -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div class="bg-white p-5 rounded-lg shadow-sm border border-slate-200 space-y-3">
                    <div class="flex flex-wrap justify-between items-center gap-2">
                        <h3 class="text-sm font-bold text-slate-800">Tabla de Iteraciones / Puntos</h3>
                        <select id="m${mod}-select-iter" onchange="AppUI.renderTablaIteraciones(${mod})"
                            class="border border-slate-300 rounded px-2.5 py-1 text-xs bg-white"></select>
                    </div>
                    <div class="max-h-72 overflow-auto border border-slate-200 rounded">
                        <table class="w-full text-left border-collapse text-xs font-mono">
                            <thead id="m${mod}-thead-iter" class="bg-slate-100 sticky top-0 border-b"></thead>
                            <tbody id="m${mod}-tbody-iter" class="divide-y divide-slate-200"></tbody>
                        </table>
                    </div>
                </div>
                <div id="m${mod}-panel-extra" class="bg-white p-5 rounded-lg shadow-sm border border-slate-200 space-y-3 overflow-x-auto"></div>
            </div>

            <!-- 8. Sensibilidad -->
            <div class="bg-white p-5 rounded-lg shadow-sm border border-slate-200 space-y-2 overflow-x-auto">
                <h3 class="text-sm font-bold text-slate-800">Análisis de Sensibilidad ante Perturbaciones</h3>
                <table class="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                        <tr class="bg-slate-100 border-b border-slate-300">
                            <th class="p-2">Parámetro</th><th class="p-2">Salida</th><th class="p-2">Base</th>
                            <th class="p-2">Perturbado</th><th class="p-2">Sensibilidad S</th><th class="p-2">Tipo</th><th class="p-2">Nota</th>
                        </tr>
                    </thead>
                    <tbody id="m${mod}-tabla-sens" class="divide-y divide-slate-200"></tbody>
                </table>
            </div>

            <!-- 9. Interpretación (Conclusiones dobles) y Avisos -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div class="bg-slate-900 text-slate-100 p-5 rounded-lg shadow-sm space-y-2">
                    <h3 class="text-sm font-bold uppercase tracking-wide text-sky-300">Conclusión Numérica</h3>
                    <p id="m${mod}-conc-num" class="text-xs sm:text-sm leading-relaxed"></p>
                </div>
                <div class="bg-emerald-950 text-emerald-50 p-5 rounded-lg shadow-sm space-y-2">
                    <h3 class="text-sm font-bold uppercase tracking-wide text-emerald-300">Conclusión del Problema</h3>
                    <div id="m${mod}-conc-prob" class="text-xs sm:text-sm leading-relaxed space-y-2"></div>
                </div>
            </div>
            <div id="m${mod}-avisos" class="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-950 space-y-1"></div>

            <!-- 10. Comparación de 3 escenarios dentro del módulo -->
            <div id="m${mod}-comp3-box" class="hidden bg-white p-5 rounded-lg shadow-sm border border-slate-200 space-y-3 overflow-x-auto"></div>
        `;
        sec.dataset.built = "1";
        cargarPresetEnFormulario(mod);
    }

    function leerParamsFormulario(mod) {
        const cfg = MODULO_CONFIG[mod];
        const p = {};
        for (const pm of cfg.paramsMeta) {
            const el = document.getElementById(`m${mod}-p-${pm.key}`);
            if (!el) continue;
            p[pm.key] = pm.type === "select" ? el.value : (el.value === "" ? NaN : Number(el.value));
        }
        return p;
    }

    function escribirParamsFormulario(mod, params) {
        const cfg = MODULO_CONFIG[mod];
        for (const pm of cfg.paramsMeta) {
            const el = document.getElementById(`m${mod}-p-${pm.key}`);
            if (el && params[pm.key] !== undefined) el.value = params[pm.key];
        }
        validarFormulario(mod);
    }

    function validarFormulario(mod) {
        const p = leerParamsFormulario(mod);
        const errs = root.MotorSIMTELE.validar(mod, p);
        const errBox = document.getElementById(`m${mod}-errores-val`);
        const btn = document.getElementById(`m${mod}-btn-ejecutar`);
        if (errs.length > 0) {
            errBox.innerHTML = `<strong>Parámetros inválidos:</strong><ul class="list-disc pl-5">${errs.map(e => `<li>${escHtml(e)}</li>`).join("")}</ul>`;
            errBox.classList.remove("hidden");
            btn.disabled = true;
        } else {
            errBox.classList.add("hidden");
            errBox.innerHTML = "";
            btn.disabled = false;
        }
        return errs;
    }

    function cargarPresetEnFormulario(mod) {
        const esc = document.getElementById(`m${mod}-escenario`).value;
        document.getElementById(`m${mod}-esc-nombre`).innerText = ESCENARIOS_LABEL[esc] || esc;
        document.getElementById(`m${mod}-esc-desc`).innerText = MODULO_CONFIG[mod].escenariosDesc[esc] || "";
        escribirParamsFormulario(mod, root.MotorSIMTELE.PRESETS[mod][esc]);
    }

    function onEscenarioChange(mod) {
        cargarPresetEnFormulario(mod);
    }

    function onParamChange(mod) {
        validarFormulario(mod);
    }

    function limpiarBanner(mod) {
        const b = document.getElementById(`m${mod}-banner-recuperada`);
        if (b) b.classList.add("hidden");
        const r = document.getElementById(`m${mod}-repro-box`);
        if (r) r.classList.add("hidden");
    }

    function cardInd(titulo, valor, sub = "", claseExtra = "bg-white border-slate-200") {
        return `<div class="p-3 rounded-lg border shadow-sm ${claseExtra}">
            <div class="text-[11px] font-semibold text-slate-500 uppercase">${titulo}</div>
            <div class="text-sm sm:text-base font-bold font-mono text-slate-900 mt-0.5">${valor}</div>
            ${sub ? `<div class="text-[11px] text-slate-600 mt-0.5">${sub}</div>` : ""}
        </div>`;
    }

    // --- CONCLUSIONES ---
    function conclusionesM1(data) {
        const ind = data.indicadores;
        const mMap = Object.fromEntries(data.metodos.map(m => [m.id, m]));
        const ord2 = ind.orden_rk2 !== null ? ind.orden_rk2.toFixed(2) : "N/A";
        const ord4 = ind.orden_rk4 !== null ? ind.orden_rk4.toFixed(2) : "N/A";
        const kRaiz = ind.derivada_en_raiz > 1e-14 ? (1.0 / ind.derivada_en_raiz).toFixed(3) : "∞";

        let num = `En EDO, RK4 obtuvo error ${fmtNum(mMap.rk4.error_abs)} (orden observado ${ord4}) frente a RK2 con ${fmtNum(mMap.rk2.error_abs)} (orden ${ord2}). ` +
            `En integración de distancia de frenado, Simpson (${fmtNum(mMap.simpson.error_abs)}) y Romberg (${fmtNum(mMap.romberg.error_abs)}) superan ampliamente a Trapecio (${fmtNum(mMap.trapecio.error_abs)}). `;
        if (data.params.formulacion === "doble") {
            num += `En raíces (formulación doble), f'(t*)=${fmtNum(ind.derivada_en_raiz)} y κ_raíz=${kRaiz}: Newton-Raphson cae a convergencia lineal (${mMap.newton.iteraciones.length} iteraciones frente a ~4 en simple), lo cual evidencia mal condicionamiento de raíz múltiple y NO un fallo de convergencia; Bisección mantiene convergencia garantizada (${mMap.biseccion.iteraciones.length} iter.).`;
        } else {
            num += `En raíces, con derivada bien separada de cero (|f'(t*)|=${fmtNum(ind.derivada_en_raiz)}, κ_raíz=${kRaiz}), Newton converge en ${mMap.newton.iteraciones.length} iteraciones, Secante en ${mMap.secante.iteraciones.length} y Bisección en ${mMap.biseccion.iteraciones.length}.`;
        }

        const prob = `<p>El tiempo total estimado hasta detención completa es <strong>${ind.t_total.toFixed(3)} s</strong> y la distancia total es <strong>${ind.d_total_num.toFixed(3)} m</strong> ` +
            `(ref. analítica ${ind.d_total_ref.toFixed(3)} m), frente a una distancia disponible de ${data.params.d_disp.toFixed(2)} m: <strong>${ind.cumple ? "CUMPLE (margen +" + ind.margen.toFixed(3) + " m)" : "NO CUMPLE (exceso " + Math.abs(ind.margen).toFixed(3) + " m)"}</strong>.</p>` +
            `<p><strong>Qué no puede inferirse:</strong> Este modelo sintético asume desaceleración lineal en v sobre vía homogénea; no permite certificar distancias reales de frenado ni sustituye pruebas mecánicas en cabinas físicas.</p>`;
        return { num, prob };
    }

    function conclusionesM2(data) {
        const ind = data.indicadores;
        const mMap = Object.fromEntries(data.metodos.map(m => [m.id, m]));
        let num = `La matriz A (κ₂ = ${fmtNum(ind.kappa2, 2)}, ${ind.spd ? "SPD" : "no SPD"}, ${ind.diag_dominante ? "estrict. diag. dom." : "NO diag. dom."}) presenta radio espectral de Jacobi ρ(T_J) = ${ind.rho_jacobi.toFixed(4)}. `;
        if (data.escenario === "MAL_CONDICIONADO" || !mMap.jacobi.convergio) {
            num += `Jacobi diverge porque ρ(T_J) ≥ 1 (fallo de convergencia del método estacionario). En contraste, Gauss-Seidel no alcanza la tolerancia en ${mMap.gauss_seidel.max_iter} iteraciones por la lentitud inducida por κ₂ alto (convergencia lenta, NO divergencia, pues ρ(T_GS) < 1 en matrices SPD), mostrando residuo pequeño (${fmtNum(mMap.gauss_seidel.residual)}) frente a un error absoluto mucho mayor (${fmtNum(mMap.gauss_seidel.error_abs)}). Gradiente Conjugado converge en ${mMap.gradiente_conjugado.iteraciones.length} iteraciones y LU en 1 paso. `;
        } else {
            num += `Todos los métodos lineales convergen: LU (1 paso), Gradiente Conjugado (${mMap.gradiente_conjugado.iteraciones.length} iter.), Gauss-Seidel (${mMap.gauss_seidel.iteraciones.length} iter.) y Jacobi (${mMap.jacobi.iteraciones.length} iter.). `;
        }
        if (ind.amplificacion !== null) {
            num += `Ante Δb, ||δx||/||x*|| = ${fmtNum(ind.rel_dx2)} ≤ cota κ₂·||δb||/||b₀|| = ${fmtNum(ind.cota)} (amplificación ${fmtNum(ind.amplificacion, 3)} ≤ κ₂). `;
        }
        num += `Para la raíz D(t)=D_umbral, Newton converge en ${mMap.newton.iteraciones.length} iter., Secante en ${mMap.secante.iteraciones.length} y Bisección en ${mMap.biseccion.iteraciones.length} (|D'(t*)|=${fmtNum(ind.derivada_en_raiz)}, κ_raíz=${fmtNum(ind.cond_raiz, 2)}).`;

        const prob = `<p>El umbral normativo hipotético (${data.params.d_umbral}%) se alcanza en <strong>t* = ${ind.t_umbral_ref.toFixed(4)} kh</strong>. ` +
            `Si se retrasa la inspección en ${data.params.retraso} kh, el deterioro proyectado sube a <strong>${ind.D_retraso.toFixed(2)}%</strong> (exceso de +${ind.exceso.toFixed(2)}% sobre el umbral). En escenarios de sensibilidad alta (como Hilbert o umbral casi tangente), pequeñas variaciones de medición modifican fuertemente el vector de pesos x y la ventana temporal.</p>` +
            `<p><strong>Qué no puede inferirse:</strong> Los coeficientes y la ley cuadrática son sintéticos; no representan tasas reales de fatiga de mordazas o rodamientos ni autorizan extender intervalos reales de mantenimiento.</p>`;
        return { num, prob };
    }

    function conclusionesM3(data) {
        const ind = data.indicadores;
        const mMap = Object.fromEntries(data.metodos.map(m => [m.id, m]));
        const ord2 = ind.orden_rk2 !== null ? ind.orden_rk2.toFixed(2) : "N/A";
        const ord4 = ind.orden_rk4 !== null ? ind.orden_rk4.toFixed(2) : "N/A";
        let num = `Frente a la referencia ${ind.tipo_referencia}, RK4 logra error máximo ${fmtNum(ind.err_max_rk4)} (orden ${ord4}) y RK2 ${fmtNum(ind.err_max_rk2)} (orden ${ord2}), verificando que Heun introduce amortiguamiento/amplificación numérica artificial. El parámetro de estabilidad h·ω₀ = ${ind.h_omega0.toFixed(3)} ${ind.h_omega0 <= 2.78 ? "cumple el límite RK4 (≤ 2.78)" : "SUPERA el límite RK4 (> 2.78)"}. `;
        if (mMap.romberg.convergio) {
            num += `En la integral de energía ∫x²dt, Romberg converge en ${mMap.romberg.iteraciones.length} niveles (error ${fmtNum(mMap.romberg.error_abs)}) frente a Simpson (${fmtNum(mMap.simpson.error_abs)}) y Trapecio (${fmtNum(mMap.trapecio.error_abs)}).`;
        } else {
            num += `En la integral de energía ∫x²dt, Romberg alcanzó el máximo de 10 niveles (1024 subintervalos) porque el integrando es altamente oscilatorio en T=${data.params.T} s y requiere más niveles para cerrar la tolerancia ${data.params.tol_romberg}, aunque ya alcanza error ${fmtNum(mMap.romberg.error_abs)} (muy inferior a Trapecio ${fmtNum(mMap.trapecio.error_abs)}).`;
        }

        let resTxt = "";
        if (ind.factor_amplificacion !== null) {
            resTxt = ` Bajo forzamiento armónico, el factor de amplificación estacionario es <strong>${ind.factor_amplificacion.toFixed(2)}×</strong> (sensibilidad frecuencial S_ω = ${ind.S_omega.toFixed(2)}).`;
        }
        const prob = `<p>Con frecuencia natural ω₀ = ${ind.omega0.toFixed(4)} rad/s y amortiguamiento ζ = ${ind.zeta.toFixed(4)}, la amplitud máxima simulada por RK4 es <strong>${ind.amp_max_rk4.toFixed(4)} m</strong> y la energía vibratoria acumulada por Simpson es <strong>${mMap.simpson.resultado.toFixed(4)} m²·s</strong>.${resTxt}</p>` +
            `<p><strong>Qué no puede inferirse:</strong> El modelo pendular lineal 1-GDL con fuerza senoidal pura no captura turbulencia estocástica, acoplamiento de cables adyacentes ni límites estructurales reales de operación.</p>`;
        return { num, prob };
    }

    function conclusionesM4(data) {
        const ind = data.indicadores;
        const mMap = Object.fromEntries(data.metodos.map(m => [m.id, m]));
        let num = `Lagrange y Newton en diferencias divididas producen el mismo polinomio interpolante único (diferencia máxima ${fmtNum(ind.max_dif_lag_newton)} < 1e-8). ` +
            `Con n=${data.params.n_nodos} nodos (${data.params.distribucion}), la constante de Lebesgue es Λ = ${fmtNum(ind.lebesgue, 2)}, lo que cuantifica la amplificación de ruido (σ=${data.params.sigma}). ` +
            (ind.lebesgue > 100
                ? `En nodos equiespaciados de grado alto aparece fenómeno de Runge severo (RMSE Lagrange=${fmtNum(ind.rmse_lag)}) frente a Splines Cúbicos Naturales (RMSE=${fmtNum(ind.rmse_spl)}); cambiar a nodos de Chebyshev reduce drásticamente Λ y el error.`
                : `Los Splines Cúbicos Naturales obtienen RMSE=${fmtNum(ind.rmse_spl)} y el polinomio global RMSE=${fmtNum(ind.rmse_lag)}.`);

        const cruceTxt = mMap.biseccion_cruce.convergio
            ? `El primer cruce de umbral (y=${data.params.y_umbral}) sobre el spline se detecta en <strong>t = ${mMap.biseccion_cruce.resultado.toFixed(5)} s</strong> (error vs exacta: ${fmtNum(mMap.biseccion_cruce.error_abs)} s).`
            : `No se detectó cruce con el umbral y=${data.params.y_umbral} en el intervalo.`;
        const prob = `<p>La reconstrucción en puntos medios ocultados presenta error máximo de ${fmtNum(mMap.spline_natural.error_abs)} en Splines frente a ${fmtNum(mMap.lagrange.error_abs)} en Lagrange. ${cruceTxt}</p>` +
            `<p><strong>Qué no puede inferirse:</strong> La señal y_ex(t) y el ruido determinista son sintéticos; estos errores no reemplazan la calibración ni la redundancia física de sensores reales en torres.</p>`;
        return { num, prob };
    }

    // --- RENDERIZADO DE RESULTADOS DE MÓDULO ---
    function renderIndicadores(mod, data) {
        const box = document.getElementById(`m${mod}-indicadores`);
        const ind = data.indicadores;
        if (mod === 1) {
            const kRaiz = ind.derivada_en_raiz > 1e-14 ? fmtNum(1.0 / ind.derivada_en_raiz, 3) : "∞";
            box.innerHTML = [
                cardInd("Tiempo detención t_total", `${ind.t_total.toFixed(4)} s`, `t_det ref = ${ind.t_det_ref.toFixed(4)} s`),
                cardInd("Distancia total (Simpson)", `${ind.d_total_num.toFixed(4)} m`, `Ref. analítica = ${ind.d_total_ref.toFixed(4)} m`),
                cardInd("Distancia disponible", ind.cumple ? "CUMPLE ✓" : "NO CUMPLE ✗", `Margen = ${ind.margen.toFixed(4)} m`, ind.cumple ? "bg-emerald-50 border-emerald-300" : "bg-red-50 border-red-300"),
                cardInd("Cond. raíz y órdenes EDO", `κ_raíz = ${kRaiz}`, `|f'(t*)|=${fmtNum(ind.derivada_en_raiz)} · p₂=${ind.orden_rk2 ? ind.orden_rk2.toFixed(2) : "N/A"}, p₄=${ind.orden_rk4 ? ind.orden_rk4.toFixed(2) : "N/A"}`)
            ].join("");
        } else if (mod === 2) {
            const cotaOk = ind.amplificacion !== null ? (ind.rel_dx2 <= ind.cota * (1 + 1e-9)) : true;
            const ampOk = ind.amplificacion !== null ? (ind.amplificacion <= ind.kappa2 * (1 + 1e-9)) : true;
            box.innerHTML = [
                cardInd("Condición κ₂(A) y λ", `${fmtNum(ind.kappa2, 2)}`, `λ∈[${fmtNum(ind.lambda_min, 3)}, ${fmtNum(ind.lambda_max, 3)}] · ${ind.spd ? "SPD" : "No SPD"}`),
                cardInd("Radio espectral Jacobi ρ(T_J)", `${ind.rho_jacobi.toFixed(4)}`, ind.rho_jacobi < 1 ? "ρ < 1 (converge)" : "ρ ≥ 1 (diverge)", ind.rho_jacobi < 1 ? "bg-white border-slate-200" : "bg-red-50 border-red-300"),
                cardInd("Desigualdades perturbación", ind.amplificacion !== null ? `amp=${fmtNum(ind.amplificacion, 3)}` : "Δb = 0",
                    ind.amplificacion !== null ? `‖Δx‖/‖x‖=${fmtNum(ind.rel_dx2)} ≤ ${fmtNum(ind.cota)} ${cotaOk ? "✓" : "✗"} · amp ≤ κ₂ ${ampOk ? "✓" : "✗"}` : "Sin perturbación aplicada"),
                cardInd("Umbral t* y retraso", `${ind.t_umbral_ref.toFixed(4)} kh`, `D(+${data.params.retraso}kh)=${ind.D_retraso.toFixed(2)}% (+${ind.exceso.toFixed(2)}%) · κ_raíz=${fmtNum(ind.cond_raiz, 2)}`)
            ].join("");
        } else if (mod === 3) {
            box.innerHTML = [
                cardInd("Frecuencia y amortiguamiento", `ω₀=${ind.omega0.toFixed(4)}`, `ζ=${ind.zeta.toFixed(4)} · ${ind.tipo_referencia}`),
                cardInd("Amplitud máx. RK4 vs Ref.", `${ind.amp_max_rk4.toFixed(4)} m`, `Ref = ${ind.amp_max_ref.toFixed(4)} m`),
                cardInd("Errores y orden EDO", `RK4: ${fmtNum(ind.err_max_rk4)}`, `RK2: ${fmtNum(ind.err_max_rk2)} · p₂=${ind.orden_rk2 ? ind.orden_rk2.toFixed(2) : "N/A"}, p₄=${ind.orden_rk4 ? ind.orden_rk4.toFixed(2) : "N/A"}`),
                cardInd("Estabilidad y resonancia", `h·ω₀ = ${ind.h_omega0.toFixed(3)}`, ind.factor_amplificacion !== null ? `Amp. est.=${ind.factor_amplificacion.toFixed(2)}× · S_ω=${ind.S_omega.toFixed(2)}` : "Oscilación libre (F₀=0)", ind.h_omega0 > 2.78 ? "bg-red-50 border-red-300" : "bg-white border-slate-200")
            ].join("");
        } else if (mod === 4) {
            const mCruce = data.metodos.find(m => m.id === "biseccion_cruce");
            box.innerHTML = [
                cardInd("Constante de Lebesgue Λ", fmtNum(ind.lebesgue, 2), ind.lebesgue > 100 ? "Riesgo Runge alto (Λ>100)" : "Condicionamiento controlado", ind.lebesgue > 100 ? "bg-amber-50 border-amber-300" : "bg-white border-slate-200"),
                cardInd("RMSE Lagrange / Newton", fmtNum(ind.rmse_lag), `|Lag − New| máx = ${fmtNum(ind.max_dif_lag_newton)}`),
                cardInd("RMSE Splines Naturales", fmtNum(ind.rmse_spl), "Cúbico por tramos (C²)"),
                cardInd("Primer cruce de umbral", mCruce.convergio ? `${mCruce.resultado.toFixed(5)} s` : "Sin cruce", mCruce.convergio ? `Ref=${fmtNum(mCruce.referencia, 5)} · Err=${fmtNum(mCruce.error_abs)}` : `y_umbral=${data.params.y_umbral}`)
            ].join("");
        }
    }

    function renderCharts(mod, data) {
        const s = data.series;
        if (mod === 1) {
            destroyChart("c-m1-vel");
            charts["c-m1-vel"] = new Chart(document.getElementById("c-m1-vel"), {
                type: "line",
                data: {
                    labels: s.t.map(v => v.toFixed(2)),
                    datasets: [
                        { label: "Referencia", data: s.ref_v, borderColor: "#10b981", borderDash: [5, 4], pointRadius: 0 },
                        { label: "RK4", data: s.rk4_v, borderColor: "#2563eb", pointRadius: 1 },
                        { label: "RK2 (Heun)", data: s.rk2_v, borderColor: "#f59e0b", pointRadius: 1 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });

            destroyChart("c-m1-err");
            charts["c-m1-err"] = new Chart(document.getElementById("c-m1-err"), {
                type: "line",
                data: {
                    labels: s.t.map(v => v.toFixed(2)),
                    datasets: [
                        { label: "Log10 Err RK2", data: s.err_rk2.map(logSafe), borderColor: "#f59e0b", pointRadius: 1 },
                        { label: "Log10 Err RK4", data: s.err_rk4.map(logSafe), borderColor: "#2563eb", pointRadius: 1 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });

            const raices = data.metodos.filter(m => m.familia === "Raíces");
            const colR = { biseccion: "#10b981", newton: "#dc2626", secante: "#7c3aed" };
            destroyChart("c-m1-raiz");
            charts["c-m1-raiz"] = new Chart(document.getElementById("c-m1-raiz"), {
                type: "line",
                data: {
                    datasets: raices.map(m => ({
                        label: m.nombre,
                        data: m.iteraciones.map(it => ({ x: it.n, y: logSafe(it.error_abs) })),
                        borderColor: colR[m.id] || "#334155",
                        fill: false
                    }))
                },
                options: { responsive: true, maintainAspectRatio: false, parsing: false, scales: { x: { type: "linear", title: { display: true, text: "Iteración" } }, y: { title: { display: true, text: "Log10(Error)" } } } }
            });

            destroyChart("c-m1-int");
            charts["c-m1-int"] = new Chart(document.getElementById("c-m1-int"), {
                type: "line",
                data: {
                    labels: data.refinamiento.map(r => r.n),
                    datasets: [
                        { label: "Log10 Err Trapecio", data: data.refinamiento.map(r => logSafe(r.err_trap)), borderColor: "#f97316" },
                        { label: "Log10 Err Simpson", data: data.refinamiento.map(r => logSafe(r.err_simp)), borderColor: "#2563eb" }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: "Subintervalos n" } } } }
            });
        } else if (mod === 2) {
            const sl = data.metodos.filter(m => m.familia === "Sistemas Lineales" && m.id !== "directa");
            const colS = { lu: "#10b981", jacobi: "#ef4444", gauss_seidel: "#f59e0b", gradiente_conjugado: "#2563eb" };
            destroyChart("c-m2-sl");
            charts["c-m2-sl"] = new Chart(document.getElementById("c-m2-sl"), {
                type: "line",
                data: {
                    datasets: sl.map(m => ({
                        label: m.nombre,
                        data: m.iteraciones.filter(it => it.error_abs !== null).map(it => ({ x: it.n, y: logSafe(it.error_abs) })),
                        borderColor: colS[m.id] || "#475569",
                        fill: false
                    }))
                },
                options: { responsive: true, maintainAspectRatio: false, parsing: false, scales: { x: { type: "linear", title: { display: true, text: "Iteración" } }, y: { title: { display: true, text: "Log10(Error Abs.)" } } } }
            });

            const rz = data.metodos.filter(m => m.familia === "Raíces");
            const colR = { biseccion: "#10b981", newton: "#2563eb", secante: "#7c3aed" };
            destroyChart("c-m2-raiz");
            charts["c-m2-raiz"] = new Chart(document.getElementById("c-m2-raiz"), {
                type: "line",
                data: {
                    datasets: rz.map(m => ({
                        label: m.nombre,
                        data: m.iteraciones.map(it => ({ x: it.n, y: logSafe(it.residual) })),
                        borderColor: colR[m.id] || "#334155",
                        fill: false
                    }))
                },
                options: { responsive: true, maintainAspectRatio: false, parsing: false, scales: { x: { type: "linear", title: { display: true, text: "Iteración" } }, y: { title: { display: true, text: "Log10(|D(t)-D_u|)" } } } }
            });

            destroyChart("c-m2-curva");
            charts["c-m2-curva"] = new Chart(document.getElementById("c-m2-curva"), {
                type: "line",
                data: {
                    datasets: [
                        { label: "D(t)", data: s.t.map((t, i) => ({ x: t, y: s.D[i] })), borderColor: "#2563eb", pointRadius: 0 },
                        { label: "Umbral", data: s.t.map((t, i) => ({ x: t, y: s.umbral[i] })), borderColor: "#dc2626", borderDash: [6, 4], pointRadius: 0 },
                        { label: "Raíz t*", data: s.t_star !== null ? [{ x: s.t_star, y: s.d_umbral }] : [], borderColor: "#059669", backgroundColor: "#059669", pointRadius: 6, showLine: false }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, parsing: false, scales: { x: { type: "linear", title: { display: true, text: "t (kh)" } } } }
            });
        } else if (mod === 3) {
            destroyChart("c-m3-osc");
            charts["c-m3-osc"] = new Chart(document.getElementById("c-m3-osc"), {
                type: "line",
                data: {
                    labels: s.t.map(v => v.toFixed(2)),
                    datasets: [
                        { label: "Referencia", data: s.ref_x, borderColor: "#10b981", borderDash: [5, 4], pointRadius: 0 },
                        { label: "RK4", data: s.rk4_x, borderColor: "#2563eb", pointRadius: 0 },
                        { label: "RK2 (Heun)", data: s.rk2_x, borderColor: "#f59e0b", pointRadius: 0 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });

            destroyChart("c-m3-err");
            charts["c-m3-err"] = new Chart(document.getElementById("c-m3-err"), {
                type: "line",
                data: {
                    labels: s.t.map(v => v.toFixed(2)),
                    datasets: [
                        { label: "Log10 Err RK2", data: s.err_rk2.map(logSafe), borderColor: "#f59e0b", pointRadius: 0 },
                        { label: "Log10 Err RK4", data: s.err_rk4.map(logSafe), borderColor: "#2563eb", pointRadius: 0 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });

            destroyChart("c-m3-int");
            charts["c-m3-int"] = new Chart(document.getElementById("c-m3-int"), {
                type: "line",
                data: {
                    labels: data.refinamiento.map(r => r.n),
                    datasets: [
                        { label: "Log10 Err Trapecio", data: data.refinamiento.map(r => logSafe(r.err_trap)), borderColor: "#f97316" },
                        { label: "Log10 Err Simpson", data: data.refinamiento.map(r => logSafe(r.err_simp)), borderColor: "#2563eb" }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: "Subintervalos n" } } } }
            });
        } else if (mod === 4) {
            const minRef = Math.min(...s.ref) - 1.0;
            const maxRef = Math.max(...s.ref) + 1.0;
            destroyChart("c-m4-curvas");
            charts["c-m4-curvas"] = new Chart(document.getElementById("c-m4-curvas"), {
                type: "line",
                data: {
                    datasets: [
                        { label: "Referencia y_ex", data: s.t.map((t, i) => ({ x: t, y: s.ref[i] })), borderColor: "#10b981", borderDash: [5, 4], pointRadius: 0 },
                        { label: "Lagrange", data: s.t.map((t, i) => ({ x: t, y: s.lag[i] })), borderColor: "#f97316", pointRadius: 0 },
                        { label: "Newton DD", data: s.t.map((t, i) => ({ x: t, y: s.newton[i] })), borderColor: "#06b6d4", borderDash: [2, 2], pointRadius: 0 },
                        { label: "Splines Naturales", data: s.t.map((t, i) => ({ x: t, y: s.spline[i] })), borderColor: "#7c3aed", pointRadius: 0 },
                        { label: "Nodos muestreo", data: s.nodos_t.map((t, i) => ({ x: t, y: s.nodos_y[i] })), borderColor: "#0f172a", backgroundColor: "#0f172a", pointRadius: 4, showLine: false },
                        { label: "Puntos ocultados", data: s.ocultos_t.map((t, i) => ({ x: t, y: s.ocultos_y[i] })), borderColor: "#dc2626", backgroundColor: "#dc2626", pointRadius: 4, pointStyle: "triangle", showLine: false }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, parsing: false,
                    scales: { x: { type: "linear", title: { display: true, text: "t (s)" } }, y: { min: minRef, max: maxRef } }
                }
            });

            destroyChart("c-m4-err");
            charts["c-m4-err"] = new Chart(document.getElementById("c-m4-err"), {
                type: "line",
                data: {
                    labels: s.t.map(v => v.toFixed(2)),
                    datasets: [
                        { label: "Log10 Err Lagrange", data: s.err_lag.map(logSafe), borderColor: "#f97316", pointRadius: 0 },
                        { label: "Log10 Err Newton DD", data: s.err_new.map(logSafe), borderColor: "#06b6d4", borderDash: [3, 3], pointRadius: 0 },
                        { label: "Log10 Err Splines", data: s.err_spl.map(logSafe), borderColor: "#7c3aed", pointRadius: 0 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });

            destroyChart("c-m4-rmse");
            charts["c-m4-rmse"] = new Chart(document.getElementById("c-m4-rmse"), {
                type: "bar",
                data: {
                    labels: ["Lagrange", "Newton DD", "Splines"],
                    datasets: [{ label: "RMSE", data: [data.indicadores.rmse_lag, data.indicadores.rmse_new, data.indicadores.rmse_spl], backgroundColor: ["#f97316", "#06b6d4", "#7c3aed"] }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }
    }

    function renderTablaIteraciones(mod) {
        const data = ultimosResultados[mod];
        if (!data) return;
        const sel = document.getElementById(`m${mod}-select-iter`);
        const m = data.metodos.find(x => x.id === sel.value) || data.metodos[0];
        const thead = document.getElementById(`m${mod}-thead-iter`);
        const tbody = document.getElementById(`m${mod}-tbody-iter`);
        const iters = m.iteraciones || [];

        const tieneT = iters.some(r => r.t !== undefined);
        const tieneSub = iters.some(r => r.subintervalos !== undefined);
        const tieneAB = iters.some(r => r.a !== undefined && r.b !== undefined);

        let cols = `<th class="p-1.5">k</th>`;
        if (tieneT) cols += `<th class="p-1.5">t</th>`;
        if (tieneSub) cols += `<th class="p-1.5">n_sub</th>`;
        if (tieneAB) cols += `<th class="p-1.5">[a, b]</th>`;
        cols += `<th class="p-1.5">Aprox</th><th class="p-1.5">Residuo</th><th class="p-1.5">Err. Abs.</th><th class="p-1.5">Err. Rel.</th>`;
        thead.innerHTML = `<tr>${cols}</tr>`;

        tbody.innerHTML = iters.map(it => {
            let row = `<td class="p-1.5">${it.n}</td>`;
            if (tieneT) row += `<td class="p-1.5">${fmtNum(it.t, 4)}</td>`;
            if (tieneSub) row += `<td class="p-1.5">${it.subintervalos}</td>`;
            if (tieneAB) row += `<td class="p-1.5">[${fmtNum(it.a, 4)}, ${fmtNum(it.b, 4)}]</td>`;
            row += `<td class="p-1.5">${fmtRes(it.aprox)}</td>`;
            row += `<td class="p-1.5">${fmtNum(it.residual)}</td>`;
            row += `<td class="p-1.5">${fmtNum(it.error_abs)}</td>`;
            row += `<td class="p-1.5">${fmtNum(it.error_rel)}</td>`;
            return `<tr>${row}</tr>`;
        }).join("");
    }

    function renderPanelExtra(mod, data) {
        const panel = document.getElementById(`m${mod}-panel-extra`);
        if (mod === 1 || mod === 3) {
            const refRows = (data.refinamiento || []).map(r =>
                `<tr><td class="p-1.5 font-bold">${r.n}</td><td class="p-1.5">${fmtNum(r.trapecio, 6)}</td><td class="p-1.5">${fmtNum(r.err_trap)}</td><td class="p-1.5">${fmtNum(r.simpson, 6)}</td><td class="p-1.5">${fmtNum(r.err_simp)}</td></tr>`
            ).join("");
            const rombRows = (data.romberg || []).map((row, k) =>
                `<tr><td class="p-1.5 font-bold">R[${k}]</td>${row.map(v => `<td class="p-1.5">${fmtNum(v, 6)}</td>`).join("")}</tr>`
            ).join("");
            panel.innerHTML = `
                <h3 class="text-sm font-bold text-slate-800">Refinamiento de Integración y Cuadro de Romberg</h3>
                <table class="w-full text-left border-collapse text-xs font-mono">
                    <thead><tr class="bg-slate-100 border-b"><th class="p-1.5">n</th><th class="p-1.5">Trapecio</th><th class="p-1.5">Err. Trap</th><th class="p-1.5">Simpson</th><th class="p-1.5">Err. Simp</th></tr></thead>
                    <tbody class="divide-y divide-slate-200">${refRows}</tbody>
                </table>
                <div class="overflow-x-auto pt-2">
                    <div class="text-xs font-semibold text-slate-600 mb-1">Tabla triangular de Romberg:</div>
                    <table class="text-left border-collapse text-[11px] font-mono"><tbody class="divide-y divide-slate-200">${rombRows}</tbody></table>
                </div>`;
        } else if (mod === 4) {
            const coefs = (data.indicadores.newton_coefs || []).map((c, i) =>
                `<tr><td class="p-1.5 font-bold">f[t₀..t_${i}]</td><td class="p-1.5">${fmtNum(c, 6)}</td></tr>`
            ).join("");
            panel.innerHTML = `
                <h3 class="text-sm font-bold text-slate-800">Coeficientes de Diferencias Divididas de Newton</h3>
                <div class="max-h-72 overflow-auto border border-slate-200 rounded">
                    <table class="w-full text-left border-collapse text-xs font-mono">
                        <thead><tr class="bg-slate-100 border-b"><th class="p-1.5">Orden</th><th class="p-1.5">Coeficiente c_k</th></tr></thead>
                        <tbody class="divide-y divide-slate-200">${coefs}</tbody>
                    </table>
                </div>`;
        } else {
            const ind = data.indicadores;
            panel.innerHTML = `
                <h3 class="text-sm font-bold text-slate-800">Propiedades Espectrales y Resumen de Referencia</h3>
                <div class="text-xs space-y-2">
                    <p><strong>Solución preconstruida x*:</strong> <code>${fmtRes(ind.x_star)}</code></p>
                    <p><strong>Solución directa x_ref:</strong> <code>${fmtRes(ind.x_ref)}</code></p>
                    <p><strong>Autovalores extremos:</strong> λ_min = <code>${fmtNum(ind.lambda_min, 5)}</code>, λ_max = <code>${fmtNum(ind.lambda_max, 5)}</code></p>
                    <p><strong>Número de condición κ₂(A):</strong> <code>${fmtNum(ind.kappa2, 3)}</code></p>
                    <p><strong>Radio espectral Jacobi ρ(T_J):</strong> <code>${ind.rho_jacobi.toFixed(6)}</code></p>
                    <p><strong>Matriz SPD:</strong> ${ind.spd ? "Sí (todos λ > 0)" : "No"} · <strong>Diag. dominante:</strong> ${ind.diag_dominante ? "Sí" : "No"}</p>
                </div>`;
        }
    }

    function renderResultadoModulo(mod, data) {
        ultimosResultados[mod] = data;

        // Sincronizar selector de escenario y descripción
        const selEsc = document.getElementById(`m${mod}-escenario`);
        if (selEsc) selEsc.value = data.escenario;
        document.getElementById(`m${mod}-esc-nombre`).innerText = ESCENARIOS_LABEL[data.escenario] || data.escenario;
        document.getElementById(`m${mod}-esc-desc`).innerText = MODULO_CONFIG[mod].escenariosDesc[data.escenario] || "";
        escribirParamsFormulario(mod, data.params);

        renderIndicadores(mod, data);
        renderCharts(mod, data);

        // Tabla de métodos
        document.getElementById(`m${mod}-tabla-metodos`).innerHTML = data.metodos.map(m => `
            <tr>
                <td class="p-2 font-sans font-semibold text-slate-700">${m.familia}</td>
                <td class="p-2 font-sans font-bold">${m.nombre}</td>
                <td class="p-2">${fmtRes(m.resultado)}</td>
                <td class="p-2 text-emerald-700">${fmtRes(m.referencia)}</td>
                <td class="p-2">${fmtNum(m.error_abs)}</td>
                <td class="p-2">${fmtNum(m.error_rel)}</td>
                <td class="p-2">${fmtPct(m.error_pct)}</td>
                <td class="p-2">${fmtNum(m.residual)}</td>
                <td class="p-2">${(m.iteraciones || []).length}</td>
                <td class="p-2 font-bold ${m.convergio ? "text-emerald-700" : "text-red-600"}">${m.convergio ? "✓ Sí" : "✗ No"}</td>
                <td class="p-2 font-sans">${escHtml(m.criterio_parada)}</td>
                <td class="p-2">${fmtNum(m.tiempo_ms, 2)}</td>
            </tr>
        `).join("");

        // Selector de iteraciones
        const selIter = document.getElementById(`m${mod}-select-iter`);
        selIter.innerHTML = data.metodos.map(m => `<option value="${m.id}">${m.nombre} (${(m.iteraciones || []).length})</option>`).join("");
        renderTablaIteraciones(mod);
        renderPanelExtra(mod, data);

        // Tabla de sensibilidad
        document.getElementById(`m${mod}-tabla-sens`).innerHTML = (data.sensibilidad || []).map(s => `
            <tr>
                <td class="p-2 font-bold">${s.parametro}</td>
                <td class="p-2">${s.salida}</td>
                <td class="p-2">${fmtNum(s.base, 5)}</td>
                <td class="p-2">${fmtNum(s.perturbado, 5)}</td>
                <td class="p-2 font-bold">${fmtNum(s.S, 4)}</td>
                <td class="p-2 font-sans">${s.tipo}</td>
                <td class="p-2 font-sans text-slate-500">${s.nota || "—"}</td>
            </tr>
        `).join("");

        // Conclusiones dobles
        const cObj = mod === 1 ? conclusionesM1(data)
            : mod === 2 ? conclusionesM2(data)
            : mod === 3 ? conclusionesM3(data)
            : conclusionesM4(data);
        document.getElementById(`m${mod}-conc-num`).innerText = cObj.num;
        document.getElementById(`m${mod}-conc-prob`).innerHTML = cObj.prob;

        // Avisos
        document.getElementById(`m${mod}-avisos`).innerHTML = `<strong>Avisos y Notas del Experimento:</strong><ul class="list-disc pl-5 mt-1">${(data.avisos || []).map(a => `<li>${escHtml(a)}</li>`).join("")}</ul>`;
    }

    async function ejecutarModulo(mod, forzarEscenario = null) {
        construirEsqueletoModulo(mod);
        if (forzarEscenario) {
            document.getElementById(`m${mod}-escenario`).value = forzarEscenario;
            cargarPresetEnFormulario(mod);
        }
        const errs = validarFormulario(mod);
        if (errs.length > 0) return;

        limpiarBanner(mod);
        const esc = document.getElementById(`m${mod}-escenario`).value;
        const params = leerParamsFormulario(mod);
        try {
            const data = await apiEjecutar(mod, esc, params, true);
            renderResultadoModulo(mod, data);
        } catch (err) {
            if (err.errores) {
                const errBox = document.getElementById(`m${mod}-errores-val`);
                errBox.innerHTML = `<strong>Error de validación (servidor):</strong><ul class="list-disc pl-5">${err.errores.map(e => `<li>${escHtml(e)}</li>`).join("")}</ul>`;
                errBox.classList.remove("hidden");
            } else {
                alert("Error al ejecutar simulación: " + err.message);
            }
        }
    }

    function abrirModulo(mod, ejecutarNormal = false) {
        construirEsqueletoModulo(mod);
        mostrarVista(`modulo${mod}`);
        if (ejecutarNormal && !ultimosResultados[mod]) {
            ejecutarModulo(mod, "NORMAL");
        }
    }

    // --- COMPARAR 3 ESCENARIOS EN UN MÓDULO ---
    function resumenMetricaClave(mod, data) {
        const mMap = Object.fromEntries(data.metodos.map(m => [m.id, m]));
        if (mod === 1) {
            return {
                res: `t_tot=${data.indicadores.t_total.toFixed(3)}s, d=${data.indicadores.d_total_num.toFixed(3)}m`,
                err: `RK4=${fmtNum(mMap.rk4.error_abs)}, Simp=${fmtNum(mMap.simpson.error_abs)}, New=${fmtNum(mMap.newton.error_abs)}`,
                estado: data.indicadores.cumple ? "CUMPLE" : "EXCEDE d_disp"
            };
        }
        if (mod === 2) {
            return {
                res: `κ₂=${fmtNum(data.indicadores.kappa2, 1)}, t*=${data.indicadores.t_umbral_ref.toFixed(4)} kh`,
                err: `LU=${fmtNum(mMap.lu.error_abs)}, CG=${fmtNum(mMap.gradiente_conjugado.error_abs)}, GS=${fmtNum(mMap.gauss_seidel.error_abs)}`,
                estado: mMap.jacobi.convergio ? "Todos conv." : "Jacobi diverge (ρ≥1)"
            };
        }
        if (mod === 3) {
            return {
                res: `A_max=${data.indicadores.amp_max_rk4.toFixed(4)}m, E=${mMap.simpson.resultado.toFixed(4)}`,
                err: `RK4=${fmtNum(data.indicadores.err_max_rk4)}, RK2=${fmtNum(data.indicadores.err_max_rk2)}`,
                estado: data.indicadores.factor_amplificacion ? `Amp=${data.indicadores.factor_amplificacion.toFixed(1)}×` : "Libre"
            };
        }
        return {
            res: `Λ=${fmtNum(data.indicadores.lebesgue, 2)}, Spl=${fmtNum(data.indicadores.rmse_spl)}`,
            err: `Lag=${fmtNum(data.indicadores.rmse_lag)}, |L-N|=${fmtNum(data.indicadores.max_dif_lag_newton)}`,
            estado: data.indicadores.lebesgue > 100 ? "Runge severo" : "Estable"
        };
    }

    async function compararTresEscenarios(mod) {
        const box = document.getElementById(`m${mod}-comp3-box`);
        box.classList.remove("hidden");
        box.innerHTML = `<p class="text-xs text-slate-500">Ejecutando NORMAL, ESTRÉS y MAL CONDICIONADO...</p>`;
        const filas = [];
        for (const esc of ["NORMAL", "ESTRES", "MAL_CONDICIONADO"]) {
            const d = await apiEjecutar(mod, esc, null, false);
            const r = resumenMetricaClave(mod, d);
            filas.push(`<tr><td class="p-2 font-bold">${ESCENARIOS_LABEL[esc]}</td><td class="p-2 font-mono">${r.res}</td><td class="p-2 font-mono">${r.err}</td><td class="p-2">${r.estado}</td></tr>`);
        }
        box.innerHTML = `
            <h3 class="text-sm font-bold text-slate-800">Comparación Rápida de los 3 Escenarios (Módulo ${mod})</h3>
            <table class="w-full text-left border-collapse text-xs">
                <thead><tr class="bg-slate-100 border-b"><th class="p-2">Escenario</th><th class="p-2">Resultado Principal</th><th class="p-2">Errores Clave</th><th class="p-2">Diagnóstico</th></tr></thead>
                <tbody class="divide-y divide-slate-200">${filas.join("")}</tbody>
            </table>`;
    }

    // --- COMPARACIÓN 12 EXPERIMENTOS ---
    function verificarExperimento(mod, esc, data) {
        const mMap = Object.fromEntries(data.metodos.map(m => [m.id, m]));
        if (mod === 1) {
            if (esc === "NORMAL") return mMap.rk4.error_abs < 1e-6 && mMap.simpson.error_abs < 1e-6 && mMap.romberg.error_abs < 1e-7;
            if (esc === "ESTRES") return data.indicadores.cumple === false && mMap.biseccion.convergio;
            return mMap.biseccion.convergio && data.indicadores.derivada_en_raiz < 1e-10;
        }
        if (mod === 2) {
            if (esc === "NORMAL") return mMap.jacobi.convergio && mMap.gradiente_conjugado.convergio && mMap.newton.error_abs < 1e-6;
            if (esc === "ESTRES") return data.indicadores.rel_dx2 <= data.indicadores.cota * (1 + 1e-9);
            return data.indicadores.kappa2 > 1e3 && !mMap.jacobi.convergio && mMap.gradiente_conjugado.residual < 1e-6;
        }
        if (mod === 3) {
            if (esc === "NORMAL") return data.indicadores.tipo_referencia === "analítica" && mMap.rk4.error_abs < 1e-4;
            if (esc === "ESTRES") return data.indicadores.tipo_referencia.startsWith("numérica") && mMap.rk4.error_abs < mMap.rk2.error_abs;
            return data.indicadores.factor_amplificacion > 50;
        }
        if (esc === "NORMAL") return data.indicadores.rmse_spl < 0.05 && data.indicadores.max_dif_lag_newton < 1e-8;
        if (esc === "ESTRES") return data.indicadores.max_dif_lag_newton < 1e-8 && mMap.spline_natural.convergio;
        return data.indicadores.lebesgue > 100 && data.indicadores.rmse_spl < data.indicadores.rmse_lag;
    }

    async function ejecutarComparacion12() {
        const cont = document.getElementById("contenedor-comparacion-12");
        cont.innerHTML = `<p class="text-sm text-slate-600">Ejecutando los 12 experimentos...</p>`;
        const escs = ["NORMAL", "ESTRES", "MAL_CONDICIONADO"];
        const filasHtml = [];
        let okTotal = 0;

        for (const mod of [1, 2, 3, 4]) {
            const celdas = [];
            for (const esc of escs) {
                const d = await apiEjecutar(mod, esc, null, false);
                const r = resumenMetricaClave(mod, d);
                const ok = verificarExperimento(mod, esc, d);
                if (ok) okTotal++;
                celdas.push(`
                    <td class="p-3 align-top border-l border-slate-200">
                        <div class="flex justify-between items-center mb-1">
                            <span class="font-bold text-[11px] ${ok ? "text-emerald-700" : "text-red-600"}">${ok ? "✓ Verificado" : "✗ Revisar"}</span>
                            <button onclick="AppUI.abrirModulo(${mod}); AppUI.ejecutarModulo(${mod}, '${esc}')" class="text-[11px] text-blue-600 hover:underline">Abrir</button>
                        </div>
                        <div class="font-mono text-[11px] text-slate-800">${r.res}</div>
                        <div class="font-mono text-[11px] text-slate-500 mt-0.5">${r.err}</div>
                        <div class="text-[11px] text-slate-700 mt-0.5 font-semibold">${r.estado}</div>
                    </td>`);
            }
            filasHtml.push(`
                <tr class="border-b border-slate-200">
                    <td class="p-3 font-bold text-slate-900 align-top">M${mod}: ${MODULO_CONFIG[mod].titulo.replace(/^Módulo \d+:\s*/, "")}</td>
                    ${celdas.join("")}
                </tr>`);
        }

        cont.innerHTML = `
            <div class="mb-3 flex justify-between items-center text-sm">
                <span>Resumen: <strong>${okTotal} / 12</strong> experimentos cumplen los umbrales de referencia.</span>
            </div>
            <table class="w-full text-left border-collapse text-xs">
                <thead>
                    <tr class="bg-slate-100 border-b border-slate-300">
                        <th class="p-3">Módulo</th>
                        <th class="p-3">NORMAL</th>
                        <th class="p-3">ESTRÉS</th>
                        <th class="p-3">MAL CONDICIONADO</th>
                    </tr>
                </thead>
                <tbody>${filasHtml.join("")}</tbody>
            </table>`;
    }

    // --- HISTORIAL, ABRIR Y RELANZAR ---
    function abrirHistorial() {
        mostrarVista("historial");
        cargarHistorial();
    }

    async function cargarHistorial() {
        if (modoActual === "detectando") await detectarModo();
        const fMod = document.getElementById("hist-filtro-modulo").value;
        const fEsc = document.getElementById("hist-filtro-escenario").value;
        const fQ = document.getElementById("hist-filtro-q").value.trim().toLowerCase();

        let filas = [];
        if (modoActual === "servidor") {
            const qs = new URLSearchParams();
            if (fMod) qs.set("modulo", fMod);
            if (fEsc) qs.set("escenario", fEsc);
            if (fQ) qs.set("q", fQ);
            const r = await fetch(`api/simulaciones?${qs.toString()}`);
            filas = await r.json();
            document.getElementById("historial-subtitulo").innerText = "Registros recuperados desde SQLite (simtele_risk.db).";
        } else if (modoActual === "supabase") {
            let url = `${SUPABASE_URL}/rest/v1/simulacion?select=id,fecha,estado,snapshot_json,escenario:escenario_id!inner(caso_id,tipo,caso:caso_id!inner(nombre))&order=id.desc&limit=100`;
            if (fMod) url += `&escenario.caso_id=eq.${encodeURIComponent(fMod)}`;
            if (fEsc) url += `&escenario.tipo=eq.${encodeURIComponent(fEsc)}`;
            const r = await fetch(url, { headers: { apikey: SUPABASE_KEY }, cache: "no-store" });
            const raw = await r.json();
            filas = (Array.isArray(raw) ? raw : []).map(row => ({
                sim_id: row.id,
                fecha: String(row.fecha || "").replace("T", " ").substring(0, 19),
                modulo: row.escenario?.caso_id,
                caso: row.escenario?.caso?.nombre,
                tipo: row.escenario?.tipo,
                estado: row.estado,
                tiene_snapshot: Boolean(row.snapshot_json)
            })).filter(f => {
                if (!fQ) return true;
                return `#${f.sim_id} ${f.fecha} ${f.caso}`.toLowerCase().includes(fQ);
            });
            document.getElementById("historial-subtitulo").innerText = "Registros recuperados desde Supabase PostgreSQL (nube / GitHub Pages).";
        } else {
            filas = leerLocalStorage().filter(f => {
                if (fMod && String(f.modulo) !== fMod) return false;
                if (fEsc && f.tipo !== fEsc) return false;
                if (fQ) {
                    const txt = `#${f.sim_id} ${f.fecha} ${f.caso}`.toLowerCase();
                    if (!txt.includes(fQ)) return false;
                }
                return true;
            });
            document.getElementById("historial-subtitulo").innerText = "Registros recuperados desde localStorage (modo autónomo sin conexión).";
        }

        const tbody = document.getElementById("tabla-historial");
        if (filas.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">No hay simulaciones que coincidan con el filtro actual. Ejecute cualquier módulo para guardar una simulación.</td></tr>`;
            return;
        }
        tbody.innerHTML = filas.map(f => `
            <tr>
                <td class="p-2.5 font-bold font-mono">#${f.sim_id}</td>
                <td class="p-2.5">${escHtml(f.fecha)}</td>
                <td class="p-2.5">${escHtml(f.caso || ("Módulo " + f.modulo))}</td>
                <td class="p-2.5 font-semibold text-blue-700">${escHtml(f.tipo)}</td>
                <td class="p-2.5">${escHtml(f.estado || "COMPLETADO")} ${f.tiene_snapshot ? '<span class="ml-1 text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded">Snapshot</span>' : '<span class="ml-1 text-[10px] px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded">Pre-S3</span>'}</td>
                <td class="p-2.5 text-right space-x-1.5">
                    <button onclick="AppUI.abrirSimulacion(${f.sim_id})" class="px-2.5 py-1 bg-slate-700 hover:bg-slate-800 text-white rounded text-[11px] font-semibold">Abrir</button>
                    <button onclick="AppUI.relanzarSimulacion(${f.sim_id})" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-semibold">Relanzar</button>
                </td>
            </tr>
        `).join("");
    }

    async function obtenerDetalle(simId) {
        if (modoActual === "servidor") {
            const r = await fetch(`api/simulaciones/${simId}`);
            if (!r.ok) throw new Error("No se pudo recuperar la simulación #" + simId);
            return await r.json();
        }
        if (modoActual === "supabase") {
            const url = `${SUPABASE_URL}/rest/v1/simulacion?select=id,fecha,estado,snapshot_json,escenario:escenario_id(caso_id,tipo,parametros_json,caso:caso_id(nombre))&id=eq.${encodeURIComponent(simId)}&limit=1`;
            const r = await fetch(url, { headers: { apikey: SUPABASE_KEY }, cache: "no-store" });
            if (!r.ok) throw new Error("No se pudo recuperar la simulación #" + simId + " desde Supabase");
            const arr = await r.json();
            const row = arr && arr[0];
            if (!row) throw new Error("No se encontró la simulación #" + simId + " en Supabase");
            return {
                sim_id: row.id,
                fecha: String(row.fecha || "").replace("T", " ").substring(0, 19),
                modulo: row.escenario?.caso_id,
                caso: row.escenario?.caso?.nombre,
                escenario: row.escenario?.tipo,
                params: row.escenario?.parametros_json,
                snapshot: row.snapshot_json
            };
        }
        const reg = leerLocalStorage().find(x => x.sim_id === simId);
        if (!reg) throw new Error("No se encontró la simulación local #" + simId);
        return reg;
    }

    async function abrirSimulacion(simId) {
        const det = await obtenerDetalle(simId);
        const mod = Number(det.modulo);
        construirEsqueletoModulo(mod);
        mostrarVista(`modulo${mod}`);
        limpiarBanner(mod);

        const banner = document.getElementById(`m${mod}-banner-recuperada`);
        const bannerTxt = document.getElementById(`m${mod}-banner-texto`);
        banner.classList.remove("hidden");

        if (det.snapshot) {
            bannerTxt.innerText = `Simulación #${det.sim_id} recuperada (${det.fecha}) — vista restaurada desde snapshot guardado.`;
            renderResultadoModulo(mod, det.snapshot);
            estadoRecuperacion[mod] = det;
        } else {
            bannerTxt.innerText = `Simulación #${det.sim_id} (${det.fecha}) — registro anterior a Semana 3 (solo parámetros). Presione "Ejecutar" o "Relanzar" desde Historial.`;
            document.getElementById(`m${mod}-escenario`).value = det.escenario || "NORMAL";
            cargarPresetEnFormulario(mod);
            if (det.params && typeof det.params === "object") {
                const preset = root.MotorSIMTELE.PRESETS[mod][det.escenario || "NORMAL"];
                const merged = { ...preset, ...det.params };
                escribirParamsFormulario(mod, merged);
            }
        }
    }

    function diffMax(a, b) {
        if (Array.isArray(a) && Array.isArray(b)) {
            let mx = 0;
            for (let i = 0; i < a.length; i++) mx = Math.max(mx, Math.abs(Number(a[i]) - Number(b[i])));
            return mx;
        }
        if (a === null || b === null || a === undefined || b === undefined) return null;
        return Math.abs(Number(a) - Number(b));
    }

    async function relanzarSimulacion(simId) {
        const det = await obtenerDetalle(simId);
        const mod = Number(det.modulo);
        const esc = det.escenario || det.tipo || "NORMAL";
        const preset = root.MotorSIMTELE.PRESETS[mod][esc];
        const paramsUsados = det.snapshot ? det.snapshot.params : { ...preset, ...(det.params || {}) };

        construirEsqueletoModulo(mod);
        mostrarVista(`modulo${mod}`);
        limpiarBanner(mod);

        const nuevo = await apiEjecutar(mod, esc, paramsUsados, false);
        renderResultadoModulo(mod, nuevo);

        const banner = document.getElementById(`m${mod}-banner-recuperada`);
        banner.classList.remove("hidden");
        document.getElementById(`m${mod}-banner-texto`).innerText = `Relanzamiento de simulación #${det.sim_id} (${det.fecha}) — recálculo sin modificar historial.`;

        const reproBox = document.getElementById(`m${mod}-repro-box`);
        reproBox.classList.remove("hidden");

        if (det.snapshot && Array.isArray(det.snapshot.metodos)) {
            const filas = det.snapshot.metodos.map((mOld, idx) => {
                const mNew = nuevo.metodos[idx];
                const d = diffMax(mOld.resultado, mNew.resultado);
                const tol = Math.max(1e-9, mOld.tolerancia || 0);
                const ok = d !== null ? d <= tol : (mOld.resultado === mNew.resultado);
                return `<tr>
                    <td class="p-1.5 font-semibold">${mOld.nombre}</td>
                    <td class="p-1.5">${fmtRes(mOld.resultado)}</td>
                    <td class="p-1.5">${fmtRes(mNew.resultado)}</td>
                    <td class="p-1.5">${d !== null ? fmtNum(d) : "—"}</td>
                    <td class="p-1.5">${fmtNum(tol)}</td>
                    <td class="p-1.5 font-bold ${ok ? "text-emerald-700" : "text-red-600"}">${ok ? "✓ Coincide" : "✗ Difiere"}</td>
                </tr>`;
            }).join("");
            reproBox.innerHTML = `
                <h3 class="text-sm font-bold text-emerald-900">Verificación de Reproducibilidad (#${det.sim_id})</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse text-xs font-mono">
                        <thead><tr class="bg-emerald-100 border-b"><th class="p-1.5">Método</th><th class="p-1.5">Guardado</th><th class="p-1.5">Recalculado</th><th class="p-1.5">|Δ|</th><th class="p-1.5">Tolerancia</th><th class="p-1.5">Estado</th></tr></thead>
                        <tbody class="divide-y divide-emerald-200">${filas}</tbody>
                    </table>
                </div>`;
        } else {
            reproBox.innerHTML = `<p class="text-xs text-emerald-900"><strong>Relanzamiento completado:</strong> El registro #${det.sim_id} es anterior a Semana 3 (sin snapshot completo previo), por lo que se recalculó con el preset de <code>${esc}</code>.</p>`;
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        detectarModo();
    });

    root.AppUI = {
        mostrarVista,
        abrirModulo,
        ejecutarModulo,
        compararTresEscenarios,
        ejecutarComparacion12,
        onEscenarioChange,
        onParamChange,
        cargarPresetEnFormulario,
        renderTablaIteraciones,
        limpiarBanner,
        abrirHistorial,
        cargarHistorial,
        abrirSimulacion,
        relanzarSimulacion
    };
})(window);
