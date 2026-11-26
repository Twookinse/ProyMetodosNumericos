# SIMTELE-RISK | Plataforma Integrada de Métodos Numéricos (Semana 3)

**Sistema de Transporte por Cable · Simulación Numérica, Teoría de Errores y Reproducibilidad (UMSA Informática)**

🔗 **Demo en vivo (GitHub Pages):** [https://twookinse.github.io/ProyMetodosNumericos/](https://twookinse.github.io/ProyMetodosNumericos/)

## Descripción del Proyecto
Plataforma interactiva de simulación numérica y análisis transversal de errores aplicada al monitoreo de riesgos hipotéticos en sistemas de transporte por cable, con los **4 módulos de estudio activos** y los **3 escenarios experimentales** (**NORMAL**, **ESTRÉS** y **MAL CONDICIONADO**):

1. **Módulo 1 — Detención de emergencia de cabinas:** EDO (**RK2 Heun**, **RK4**), Integración (**Trapecio**, **Simpson 1/3**, **Romberg** con tabla de refinamiento) y Raíces (**Bisección**, **Newton-Raphson**, **Secante**).
2. **Módulo 2 — Deterioro mecánico y mantenimiento:** Sistemas lineales SPD $4 \times 4$ (**Eliminación directa**, **Factorización LU**, **Jacobi**, **Gauss-Seidel**, **Gradiente Conjugado**) y cálculo del tiempo al umbral con **Bisección**, **Newton-Raphson** y **Secante**.
3. **Módulo 3 — Oscilaciones laterales por viento:** EDO de 2.º orden (**RK2 Heun**, **RK4**) e integración del índice de severidad vibratoria $\int x(t)^2\,dt$ (**Trapecio**, **Simpson 1/3**, **Romberg**).
4. **Módulo 4 — Reconstrucción de señales de sensores:** Interpolación (**Lagrange**, **Newton en diferencias divididas**, **Splines Cúbicos Naturales**) con puntos ocultados, constante de Lebesgue y cruce de umbral por **Bisección**.

Incluye parámetros editables con validación en línea, análisis de sensibilidad, conclusiones dobles (numérica y del problema), comparación transversal de los 12 experimentos y persistencia completa en SQLite (`snapshot_json`) con opciones **Abrir** y **Relanzar** para verificar reproducibilidad.

## Estructura del Repositorio
- `motor_numerico.py`: Motor numérico puro en Python (12 escenarios, validación, errores transversales y sensibilidad).
- `static/js/motor.js`: Port 1:1 en JavaScript para modo autónomo en GitHub Pages.
- `static/js/app.js`: Lógica de interfaz, gráficos Chart.js, tablas, conclusiones e historial.
- `templates/index.html` / `index.html`: Interfaz web sincronizada (modo servidor Flask/SQLite y modo local `localStorage`).
- `app.py`: Servidor Flask, API REST (`/api/estado`, `/api/ejecutar/<modulo>`, `/api/simulaciones`, `/api/simulaciones/<id>`) y migración automática de BD.
- `schema.sql` / `simtele_risk.db`: Esquema relacional de 6 tablas con integridad referencial (`ON DELETE CASCADE`) y soporte para `snapshot_json`.
- `tests/`: Pruebas automatizadas (`test_motor.py`, `test_paridad.py`, `test_persistencia.py`).

## Ejecución Local con Flask
```bash
pip install flask numpy
python app.py
```
Luego abrir en el navegador la URL indicada en la terminal (por ejemplo `http://127.0.0.1:5000` o `http://127.0.0.1:5001` si el puerto 5000 está reservado por Windows).

## Pruebas Automatizadas
```bash
python tests/test_motor.py
python tests/test_paridad.py
python tests/test_persistencia.py
```
