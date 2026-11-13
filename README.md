# SIMTELE-RISK | Plataforma Integrada de Métodos Numéricos

**Sistema de Transporte por Cable · Simulación Numérica y Análisis de Errores (UMSA Informática)**

🔗 **Demo en vivo (GitHub Pages):** [https://twookinse.github.io/ProyMetodosNumericos/](https://twookinse.github.io/ProyMetodosNumericos/)

## Descripción del Proyecto
Plataforma interactiva de simulación numérica y análisis transversal de errores aplicada al monitoreo de riesgos en sistemas de transporte por cable, estructurada en 4 módulos de estudio:

1. **Módulo 1:** Detención de emergencia de cabinas (EDO + Integración + Raíces).
2. **Módulo 2 (Operativo en Semana 1):** Deterioro mecánico y mantenimiento — Calibración de sistemas lineales SPD $4 \times 4$ comparando **Jacobi**, **Gauss-Seidel**, **Factorización LU** y **Gradiente Conjugado** bajo escenarios `NORMAL`, `ESTRES` y `MAL_CONDICIONADO`.
3. **Módulo 3:** Oscilaciones por viento (EDO de 2.º orden + Integración numérica).
4. **Módulo 4:** Reconstrucción de señales de sensores (Interpolación + Calibración).

## Estructura del Repositorio
- `index.html` / `templates/index.html`: Interfaz web interactiva (compatible tanto con **GitHub Pages** en modo autónomo como con el backend Flask).
- `app.py`: Servidor backend en Python (Flask + NumPy + SQLite3).
- `schema.sql`: Esquema relacional de 6 tablas con integridad referencial (`ON DELETE CASCADE`).
- `simtele_risk.db`: Base de datos SQLite3 con el historial de simulaciones.

## Ejecución Local con Flask
```bash
pip install flask numpy
python app.py
```
Luego abrir `http://127.0.0.1:5000` en el navegador.
