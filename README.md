# SIMTELE-RISK | Plataforma Integrada de Métodos Numéricos (Avance Semana 2)

**Sistema de Transporte por Cable · Simulación Numérica y Análisis de Errores (UMSA Informática)**

🔗 **Demo en vivo (GitHub Pages):** [https://twookinse.github.io/ProyMetodosNumericos/](https://twookinse.github.io/ProyMetodosNumericos/)

## Descripción del Proyecto
Plataforma interactiva de simulación numérica y análisis transversal de errores aplicada al monitoreo de riesgos en sistemas de transporte por cable, con los **4 módulos de estudio activos**:

1. **Módulo 1 (Activo):** Detención de emergencia de cabinas — EDO (Runge-Kutta 4), Integración numérica (Simpson 1/3 compuesto) y Raíces (Bisección).
2. **Módulo 2 (Activo):** Deterioro mecánico y mantenimiento — Sistemas lineales SPD $4 \times 4$ (**Jacobi**, **Gauss-Seidel**, **Factorización LU**, **Gradiente Conjugado**) y cálculo de umbral de mantenimiento con **Newton-Raphson**.
3. **Módulo 3 (Activo):** Oscilaciones laterales por viento — Sistema de EDOs de 2.º orden (RK4) e integración del índice de severidad vibratoria (Simpson 1/3).
4. **Módulo 4 (Activo):** Reconstrucción de señales de sensores — Interpolación mediante Polinomio de Lagrange y Splines Cúbicos con evaluación de RMSE.

Cada módulo permite simular los escenarios **NORMAL**, **ESTRÉS** y **MAL CONDICIONADO**.

## Estructura del Repositorio
- `index.html` / `templates/index.html`: Interfaz web interactiva con los 4 módulos (compatible tanto con **GitHub Pages** en modo autónomo como con el backend Flask).
- `app.py`: Servidor backend en Python (Flask + NumPy + SQLite3).
- `schema.sql`: Esquema relacional de 6 tablas con integridad referencial (`ON DELETE CASCADE`).
- `simtele_risk.db`: Base de datos SQLite3 con el historial persistente de simulaciones.

## Ejecución Local con Flask
```bash
pip install flask numpy
python app.py
```
Luego abrir `http://127.0.0.1:5000` en el navegador.
