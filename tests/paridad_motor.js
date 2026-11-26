// Ejecuta los mismos casos en JS y compara 1:1 contra la salida JSON de Python.
const fs = require("fs");
const path = require("path");
const Motor = require(path.join(__dirname, "..", "static", "js", "motor.js"));

const jsonPath = process.argv[2];
if (!jsonPath) {
    console.error("Uso: node paridad_motor.js <ruta_json>");
    process.exit(1);
}

const pyData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

function closeNum(a, b, relTol = 1e-6, absTol = 1e-9) {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    const diff = Math.abs(a - b);
    return diff <= Math.max(absTol, relTol * Math.max(Math.abs(a), Math.abs(b)));
}

function cmpVal(a, b, ctx) {
    if (a === null || b === null) {
        if (a !== b) throw new Error(`${ctx}: null mismatch (${a} vs ${b})`);
        return;
    }
    if (typeof a === "boolean" || typeof b === "boolean") {
        if (a !== b) throw new Error(`${ctx}: bool mismatch (${a} vs ${b})`);
        return;
    }
    if (typeof a === "number" && typeof b === "number") {
        if (!closeNum(a, b)) throw new Error(`${ctx}: number mismatch (${a} vs ${b})`);
        return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) throw new Error(`${ctx}: array length (${a.length} vs ${b.length})`);
        for (let i = 0; i < a.length; i++) cmpVal(a[i], b[i], `${ctx}[${i}]`);
        return;
    }
    if (a !== b) throw new Error(`${ctx}: mismatch (${a} vs ${b})`);
}

// 1. Comparar PRESETS
const pyPresetsStr = JSON.stringify(pyData.presets);
const jsPresetsStr = JSON.stringify(Motor.PRESETS);
if (pyPresetsStr !== jsPresetsStr) {
    // Compare structurally
    for (const m of ["1", "2", "3", "4"]) {
        for (const e of ["NORMAL", "ESTRES", "MAL_CONDICIONADO"]) {
            const pp = pyData.presets[m][e];
            const jp = Motor.PRESETS[m][e];
            if (JSON.stringify(Object.keys(pp).sort()) !== JSON.stringify(Object.keys(jp).sort())) {
                throw new Error(`PRESETS keys mismatch M${m} ${e}`);
            }
            for (const k of Object.keys(pp)) cmpVal(pp[k], jp[k], `PRESETS[${m}][${e}].${k}`);
        }
    }
}

// 2. Comparar cada caso
for (const caso of pyData.casos) {
    const pyRes = caso.resultado;
    const jsRes = JSON.parse(JSON.stringify(Motor.ejecutar(caso.modulo, caso.escenario, caso.params || null)));
    const tag = `M${caso.modulo}:${caso.escenario}${caso.etiqueta || ""}`;

    // Métodos
    const pyIds = pyRes.metodos.map(m => m.id);
    const jsIds = jsRes.metodos.map(m => m.id);
    if (JSON.stringify(pyIds) !== JSON.stringify(jsIds)) {
        throw new Error(`${tag} metodos ids mismatch: ${pyIds} vs ${jsIds}`);
    }

    for (let i = 0; i < pyRes.metodos.length; i++) {
        const pm = pyRes.metodos[i];
        const jm = jsRes.metodos[i];
        const mTag = `${tag}.${pm.id}`;
        if (pm.convergio !== jm.convergio) {
            throw new Error(`${mTag} convergio mismatch: ${pm.convergio} vs ${jm.convergio}`);
        }
        if (pm.iteraciones.length !== jm.iteraciones.length) {
            throw new Error(`${mTag} iteraciones length mismatch: ${pm.iteraciones.length} vs ${jm.iteraciones.length}`);
        }
        cmpVal(pm.resultado, jm.resultado, `${mTag}.resultado`);
        cmpVal(pm.referencia, jm.referencia, `${mTag}.referencia`);
        cmpVal(pm.error_abs, jm.error_abs, `${mTag}.error_abs`);
        cmpVal(pm.error_rel, jm.error_rel, `${mTag}.error_rel`);
        cmpVal(pm.residual, jm.residual, `${mTag}.residual`);
    }

    // Indicadores
    for (const k of Object.keys(pyRes.indicadores)) {
        cmpVal(pyRes.indicadores[k], jsRes.indicadores[k], `${tag}.indicadores.${k}`);
    }

    // Sensibilidad
    if (pyRes.sensibilidad.length !== jsRes.sensibilidad.length) {
        throw new Error(`${tag} sensibilidad length mismatch`);
    }
    for (let i = 0; i < pyRes.sensibilidad.length; i++) {
        cmpVal(pyRes.sensibilidad[i].S, jsRes.sensibilidad[i].S, `${tag}.sens[${i}].S`);
    }
}

console.log("PARIDAD OK");
