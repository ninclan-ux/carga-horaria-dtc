# Reporte semanal de carga horaria – Docentes Tiempo Completo

Formulario web (GitHub Pages) que reemplaza al Google Form de horas DTC. El docente inicia sesión con su
cuenta @unifranz.edu.bo, elige la semana, ve **solo sus actividades** con las horas planificadas y reporta
horas no cumplidas y horas extra (o «Sin novedades» en un toque). Las respuestas se guardan en una hoja de
Google y de ahí las lee el pipeline del tablero de Power BI.

```
docs/            ← sitio estático (GitHub Pages sirve esta carpeta)
  index.html, styles.css, app.js
  config.js      ← ID de cliente OAuth y URL del Apps Script (valores públicos)
  mock.js        ← backend simulado para ?demo=1
backend/
  Code.gs        ← Apps Script vinculado a la hoja (verifica el token, lee listas, guarda respuestas)
  appsscript.json
```

## Cómo funciona

1. El navegador obtiene un *ID token* de Google (Google Identity Services).
2. Lo envía al Apps Script (POST `text/plain`, sin preflight CORS).
3. El Apps Script verifica el token: destinatario = nuestro ID de cliente, correo verificado, dominio `unifranz.edu.bo`.
4. Busca el correo en la pestaña **Docentes** (un docente puede tener varios correos) y devuelve **solo sus datos**.
5. Al enviar, valida todo de nuevo, marca como `reemplazada` el reporte anterior de esa semana y agrega las filas
   nuevas a **Respuestas** con un código `DTC-II26-XXXX`. Opcionalmente envía un comprobante por correo.

El ID de cliente y la URL del Apps Script no son secretos. La seguridad la da la verificación del token en el servidor.

## Puesta en marcha (una sola vez)

### 1. Hoja de cálculo
La hoja **«Formulario Carga Horaria DTC»** ya existe en el Drive del dueño: la creó y la llena
`Dashboard Respuestas Formulario/scripts/preparar_formulario.py`. Tiene estas pestañas (fila 1 = encabezados):

| Pestaña | Columnas |
|---|---|
| Docentes | `ci, nombre, sede, carreras, correos, activo` (`correos` separados por `;`) |
| Actividades | `codigo, nombre, grupo, activa, orden` (`codigo` = la clave del tablero, p. ej. `Clases P17`) |
| Semanas | `semestre, nro, lunes, viernes, etiqueta, hito` (fechas `AAAA-MM-DD`) |
| Plan | `semestre, ci, semana_viernes, actividad, horas_planificadas` |
| Motivos | `motivo, requiere_detalle` (`Otro` → `TRUE`) |
| Config | `clave, valor` |
| Respuestas | ver [Columnas de Respuestas](#columnas-de-respuestas) |

`Config`: `semestre_actual = II-26`, `semanas_abiertas = 3`, `correo_soporte`, `enviar_comprobante = TRUE`,
`mensaje_inicio` (opcional, se muestra como aviso).

Docentes, Semanas y Plan los llena el pipeline (`Dashboard Respuestas Formulario`). **No compartas la hoja**: solo
la cuenta dueña la necesita.

### 2. ID de cliente OAuth
Google Cloud Console → proyecto **dashboard-formulario** → *APIs y servicios* → *Credenciales* →
*Crear credenciales* → *ID de cliente de OAuth* → tipo **Aplicación web**.

- *Orígenes de JavaScript autorizados*: `https://<usuario>.github.io` y `http://localhost:8765`
- *URI de redireccionamiento*: ninguno.

La pantalla de consentimiento ya es **Interna**: solo entran cuentas de Unifranz. Copia el ID de cliente.

### 3. Apps Script
1. En la hoja: *Extensiones → Apps Script*. Pega `backend/Code.gs`.
2. *Configuración del proyecto* → marca «Mostrar el archivo de manifiesto», abre `appsscript.json` y pega el de `backend/`.
3. En `Code.gs`, reemplaza `CLIENT_ID` por el ID del paso 2.
4. Ejecuta `probarContexto` una vez para autorizar los permisos (y ver tu propio contexto si estás en Docentes).
5. *Implementar → Nueva implementación → Aplicación web*: **Ejecutar como: Yo**, **Quién tiene acceso: Cualquier usuario**.
   Copia la URL que termina en `/exec`.

> «Cualquier usuario» es necesario porque el navegador llama al script desde GitHub Pages sin cookies de Google.
> El script igual rechaza todo pedido sin un token válido de @unifranz.edu.bo. Si la consola de administración
> no permite esa opción, hay que pedir a TI que la habilite para Apps Script.

**Para actualizar el código** sin cambiar la URL: *Implementar → Gestionar implementaciones → editar (lápiz) →
Versión: Nueva versión*.

### 4. Configurar y publicar el sitio
1. En `docs/config.js` pega `CLIENT_ID` y `API_URL`.
2. Crea un repositorio en github.com (p. ej. `carga-horaria-dtc`) y sube esta carpeta:
   ```bash
   git init -b main
   git add .
   git commit -m "Formulario de carga horaria DTC"
   git remote add origin https://github.com/ninclan-ux/carga-horaria-dtc.git
   git push -u origin main
   ```
3. En GitHub: *Settings → Pages → Deploy from a branch → main → /docs*. La dirección queda en
   `https://ninclan-ux.github.io/carga-horaria-dtc/`.

## Pruebas locales

```bash
python -m http.server 8765 --directory docs
```

- `http://localhost:8765/?demo=1` → todo el flujo con datos simulados (no toca Google).
- `http://localhost:8765/?demo=noregistrado` → pantalla de cuenta no registrada.
- `http://localhost:8765/` → inicio de sesión real contra el Apps Script (requiere el origen localhost en el paso 2).

## Operación

| Necesidad | Qué hacer |
|---|---|
| Nuevo docente o correo adicional | Agregar la fila o el correo (separado por `;`) en **Docentes**. Se ve en ≤ 5 min (caché). |
| Abrir más o menos semanas | Cambiar `semanas_abiertas` en **Config**. |
| Cambiar de semestre | `semestre_actual` en **Config** + semanas y plan del nuevo semestre. |
| Anular un reporte | Buscar el código en **Respuestas** y poner `estado = anulada` en sus filas. |
| Corregir un reporte | El docente reporta la misma semana de nuevo: el anterior queda `reemplazada`. |
| Apagar el comprobante por correo | `enviar_comprobante = FALSE`. |

Validaciones del servidor: horas en pasos de 0,5 h; horas no cumplidas ≤ horas planificadas de esa actividad;
horas extra ≤ 20 por actividad y ≤ 30 por semana; motivo obligatorio; «Otro» exige detalle; solo semanas abiertas.

## Columnas de Respuestas

`codigo, estado, fecha_envio, inicio, duracion_seg, email, ci, docente, sede, carreras, semestre, semana_lunes,
semana_viernes, semana_etiqueta, tipo, actividad, actividad_nombre, horas, horas_planificadas, motivo,
detalle_motivo, comentario, dispositivo, version_formulario`

- Una fila por ítem. `tipo` ∈ `Incumplimiento`, `Hora extra`, `Sin novedades`.
- `estado` ∈ `vigente`, `reemplazada`, `anulada`. El pipeline solo usa `vigente`.
- `semestre` sale de la semana elegida (pestaña Semanas). Por eso un reporte nunca se mezcla con otro semestre.
- `duracion_seg` va desde el inicio de sesión hasta el envío.
