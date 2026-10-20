# ISUStoPRA — De ISUS a PRA

Aplicación web (PWA) para generar Programas de Refuerro del Aprendizaje (PRA)
a partir de informes ISUS/Séneca en PDF.

## Novedades de esta versión

1. **Fix tildes en nombres de alumno** — los ficheros generados (PDF, JSON, CSV)
   ya no rompen caracteres acentuados (`á`, `é`, `í`, `ó`, `ú`, `ñ`, `ç`, …).
   Se ha sustituido el regex `[^a-z0-9]/gi` por `sanitizeFilename()`, que
   conserva cualquier letra Unicode y solo elimina los caracteres realmente
   problemáticos para sistemas de ficheros (`/ \ : * ? " < > |`).
2. **Firebase** integrado (Auth + Realtime Database) con la configuración
   proporcionada.
3. **Sistema de usuarios**:
   - Primer arranque: se obliga a crear el usuario administrador inicial
     (usuario + contraseña dos veces).
   - Después, el admin puede crear usuarios con dos perfiles:
     - `usuario` → solo visualización (ver PRAs guardados).
     - `admin` → control total (generar PRAs, gestionar usuarios, borrar).
4. **Aislamiento por curso académico**: los PRAs se guardan bajo
   `/courses/{yearId}/pras/{praId}` donde `yearId` es `YYYY-YYYY`
   (1 de septiembre a 31 de agosto). Se muestra un chip en el header con el
   curso actual.
5. **Campos Grupo y Tutor/a** obligatorios al generar un PRA, visibles en
   pantalla 1 y en el PDF generado.
6. **Service Worker** (`sw.js`) con cache + chip de versión dinámico:
   - La versión se define en `sw.js` como `APP_VERSION`.
   - El SW responde a `postMessage({type:'GET_VERSION'})` con la versión.
   - Al activarse una nueva versión, notifica a todas las pestañas abiertas
     y el chip del header se refresca.
7. **Aislamiento total en la BD compartida**: todos los datos viven bajo el
   nodo `isustopra/`, de modo que el proyecto Firebase `tecdea` puede ser
   compartido por varias aplicaciones sin que ISUStoPRA pueda leer ni
   escribir datos ajenos. Ver sección "Estructura de datos en Firebase".

## Estructura de archivos

```
download/
├── index.html          ← aplicación completa
├── sw.js               ← service worker (versión dinámica + cache + autodesregistro si scope=/)
├── manifest.json       ← PWA manifest (id único + scope "./")
├── favicon.ico         ← favicon multi-resolución (16+32+48)
├── README.md           ← este archivo
└── icons/
    ├── favicon-16.png  ← favicon 16×16 (PNG moderno)
    ├── favicon-32.png  ← favicon 32×32 (PNG moderno)
    ├── icon-192.png    ← icono PWA 192×192 (también apple-touch-icon)
    └── icon-512.png    ← icono PWA 512×512
```

## Estructura de datos en Firebase (Realtime Database)

Todos los datos de ISUStoPRA se almacenan bajo el nodo raíz `isustopra/`,
lo que garantiza el aislamiento total con cualquier otra aplicación que
comparta el proyecto Firebase `tecdea`:

```
isustopra/
├── meta/
│   └── adminInitialized: true               # flag: ¿ya existe un admin?
├── users/
│   └── {uid}/                               # uid = Firebase Auth UID
│       ├── username:    "admin"             # nombre de usuario único
│       ├── role:        "admin" | "user"    # rol
│       ├── email:       "admin@tecdea.local"# email interno (no se envía)
│       ├── createdAt:   1234567890          # timestamp
│       └── createdBy:   "initial-setup" | {uid}
└── courses/
    └── {yearId}/                            # ej. "2026-2027" (sep–ago)
        └── pras/
            └── {praId}/                     # push ID generado
                ├── studentName:  "María Pérez"
                ├── group:        "4ºA"
                ├── tutor:        "Prof. García"
                ├── profile:      "profileOption1"
                ├── praType:      "PRA de PENdientes"
                ├── programType:  "Alumnado CON materias pendientes"
                ├── subjects:     [...]
                ├── evaluations:  [...]
                ├── selectedAdditionalFields: {...}
                ├── textAreaState:{...}
                ├── failedCriteria: [...]
                ├── fileName:     "PRA_CYR3_María_Pérez.pdf"
                ├── academicYear: "2026-2027"
                ├── generatedAt:  1234567890
                ├── generatedBy:  {uid}
                └── generatedByUsername: "admin"
```

> **Importante**: el código cliente siempre construye las rutas con la
> función `fbPath()` (definida en `index.html`), que añade automáticamente
> el prefijo `isustopra/`. **Nunca** se accede a la raíz de la BD. Las
> reglas de seguridad (ver más abajo) bloquean además cualquier acceso
> fuera del namespace.

## Cómo desplegar

Sirve el directorio `download/` con cualquier servidor HTTP estático:

```bash
cd download
python3 -m http.server 8080
# abre http://localhost:8080/
```

> El Service Worker solo funciona bajo HTTP(S) o en `localhost`.
> Si abres el `index.html` con `file://` el SW no se registrará pero la app
> seguirá funcionando (solo perderás offline + chip de versión dinámico).

## Despliegue bajo `tecdea.github.io/isustoprav2/` (sin interferir con el portal)

La PWA está diseñada para alojarse en el **subdirectorio** `isustoprav2/`
del portal:

```
https://tecdea.github.io/                  ← portal (NO tocar)
https://tecdea.github.io/isustoprav2/      ← PWA ISUStoPRA (v2)
```

Para que la instalación de la PWA **no interfiera** con la del portal, se
aplican **cuatro capas de aislamiento**:

### 1. Manifest con `id` único y relativo
El `manifest.json` declara `"id": "./?isustopra-app=1"` (relativo al
directorio del manifest). Chrome usa este `id` (no la URL completa) como
identidad de la PWA instalada. Al servirse el manifest desde
`tecdea.github.io/isustoprav2/manifest.json`, el `id` se resuelve como
`https://tecdea.github.io/isustoprav2/?isustopra-app=1`, así que esta PWA
es una entidad distinta del portal (y de cualquier otra app del mismo
origen).

### 2. Scope relativo `"./"`
`scope: "./"` y `start_url: "./index.html?source=pwa"` son **relativos**.
Cuando el manifest se sirve desde `tecdea.github.io/isustoprav2/manifest.json`,
el navegador los resuelve como:
- `scope` → `https://tecdea.github.io/isustoprav2/`
- `start_url` → `https://tecdea.github.io/isustoprav2/index.html?source=pwa`

La PWA instalada solo "reclama" URLs dentro de `/isustoprav2/`. La página
principal del portal sigue siendo instalable por separado.

### 3. Service Worker con scope explícito + guardas
El registro en `index.html` pasa SIEMPRE `{ scope: './' }` y, además, hace
dos comprobaciones previas:
- **Si el SW acaba en la raíz del dominio** (`/sw.js` en lugar de
  `/isustoprav2/sw.js`), NO se registra. Esto evita que un despliegue
  incorrecto haga que el SW controle todo `tecdea.github.io`.
- **Si la página actual no está bajo el directorio del SW**, NO se
  registra.

Como **doble red de seguridad**, el propio `sw.js` en su evento `activate`
comprueba `self.registration.scope`: si es la raíz del dominio, se
**desregistra a sí mismo** y libera a todos los clientes. Así, incluso si
el guard del cliente fallara, el SW no se mantendría activo en la raíz.

### 4. Cache con prefijo `isustopra-`
El nombre del cache es `isustopra-${APP_VERSION}`, de modo que ni siquiera
comparte espacio de cache con otras PWAs del mismo origen.

### Pasos de despliegue recomendados

1. Sube el contenido de `download/` al subdirectorio `isustoprav2/` del
   repo del portal:
   ```
   tecdea.github.io/
   ├── index.html          ← portal (intacto)
   ├── (otros ficheros del portal)
   └── isustoprav2/        ← contenido de download/
       ├── index.html
       ├── sw.js
       ├── manifest.json
       ├── favicon.ico
       └── icons/
   ```
2. Verifica en DevTools → Application → Service Workers que el scope del
   SW es `https://tecdea.github.io/isustoprav2/` (NO la raíz).
3. Verifica en DevTools → Application → Manifest que `id` y `scope` se
   resuelven a `/isustoprav2/...`.
4. Si en algún momento mueves la PWA de subdirectorio, cambia el `id` en
   `manifest.json` para que los usuarios tengan que reinstalar (las
   instalaciones antiguas seguirán funcionando hasta que el usuario
   desinstale).

### ¿Y si coexisten `/isustopra/` (v1) y `/isustoprav2/` (v2)?

Las dos versiones pueden convivir sin conflicto en el mismo dominio:
- Cada una tiene su propio SW con scope limitado a su subdirectorio.
- Los caches usan el mismo prefijo `isustopra-`, pero el `APP_VERSION` del
  `sw.js` de cada versión diferirá, así que los caches son distintos
  (`isustopra-v1.x-...` vs `isustopra-v1.y-...`).
- Los `id` de los manifests se resuelven a URLs distintas, así que Chrome
  las trata como dos PWAs independientes.
- Ambas comparten el **mismo namespace Firebase `isustopra/`**, de modo
  que los PRAs y usuarios generados desde cualquiera de las dos
  versiones son accesibles desde la otra. Si quisieras aislar también los
  datos entre v1 y v2, cambia el `FB_NAMESPACE` en `index.html` (p. ej. a
  `isustoprav2`) y ajusta las reglas de seguridad de Firebase
  añadiendo el nuevo namespace.

## Configuración de Firebase (una sola vez)

La configuración ya está embebida en `index.html`. Solo necesitas configurar
en la consola de Firebase:

### 1. Activar Email/Password Auth
Consola → Authentication → Sign-in method → **Email/Password** → Habilitar.

### 2. Activar Realtime Database
Consola → Realtime Database → Crear base de datos (región: `europe-west1`).

### 3. Reglas de seguridad recomendadas

Todos los datos de ISUStoPRA viven bajo el nodo `isustopra/` de la BD (esto
garantiza el aislamiento con cualquier otra app que comparta el proyecto
Firebase `tecdea`). Pega estas reglas en Consola → Realtime Database → Rules:

```json
{
  "rules": {
    // ====== NAMESPACE ISUStoPRA (aislado del resto de la BD) ======
    "isustopra": {
      "meta": {
        "adminInitialized": {
          ".read": true,
          ".write": "!root.child('isustopra/meta/adminInitialized').exists() || (auth != null && root.child('isustopra/users/' + auth.uid + '/role').val() === 'admin')"
        }
      },
      "users": {
        "$uid": {
          ".read": "auth != null",
          ".write": "auth != null && (auth.uid === $uid || root.child('isustopra/users/' + auth.uid + '/role').val() === 'admin' || !root.child('isustopra/meta/adminInitialized').exists())"
        }
      },
      "courses": {
        ".read": "auth != null",
        "$yearId": {
          "pras": {
            "$praId": {
              ".read": "auth != null",
              ".write": "auth != null && root.child('isustopra/users/' + auth.uid + '/role').val() === 'admin'"
            }
          }
        }
      }
    },

    // ====== Resto de la BD: acceso denegado por defecto ======
    // Cualquier otra app que use el mismo proyecto Firebase debe definir
    // SUS PROPIAS reglas bajo su propio namespace. Mientras tanto,
    // bloqueamos todo lo que no sea isustopra/ para que ISUStoPRA no
    // pueda leer ni escribir datos ajenos.
    "$other": {
      ".read": false,
      ".write": false
    }
  }
}
```

Estas reglas:
- **Aíslan** ISUStoPRA bajo `isustopra/`: la app no puede leer ni escribir
  ningún dato fuera de ese namespace, aunque existieran otros en la BD.
- Permiten que **cualquiera** lea `meta/adminInitialized` (para mostrar
  login o setup según corresponda).
- Permiten que **cualquiera** escriba el primer admin (mientras
  `adminInitialized` no exista).
- Después del primer admin, solo los admins pueden crear usuarios y
  escribir PRAs.
- Cualquier usuario autenticado puede leer PRAs (para el rol "usuario").
- **Bloquean** el acceso al resto de la BD (`$other: false`), de modo que
  aunque la app tenga un bug, no podrá tocar datos de otras apps.

> Si en el futuro compartes el proyecto Firebase con otra app, añade su
> propio namespace bajo `rules` (por ejemplo `"otra-app": { ... }`) con sus
> propias reglas. La regla `$other` solo afecta a rutas que no matchean
> ningún namespace explícito.

### 4. Primer arranque

1. Abre la app en el navegador.
2. Como no existe admin aún, verás el formulario **"Primer arranque — Crear administrador"**.
3. Introduce un usuario (mín. 3 caracteres, solo `a-z0-9._-`) y la contraseña dos veces (mín. 6 caracteres).
4. Se crea el admin, se marca `meta/adminInitialized = true` y se inicia sesión automáticamente.

### 5. Crear más usuarios

Desde el menú de usuario (arriba derecha) → **Gestión de usuarios**:
- Usuario (mín. 3 caracteres, `a-z0-9._-`)
- Contraseña (mín. 6 caracteres, dos veces)
- Perfil: `Usuario` (solo lectura) o `Administrador` (control total)

Internamente, los usuarios se almacenan en Firebase Auth con un email interno
`<username>@tecdea.local` (no se envían correos). La metadata (rol, username)
se guarda en `/users/{uid}`.

## Cómo usar la app

1. **Login**: introduce tu usuario y contraseña.
2. **Generar PRA** (solo admin):
   - Paso 1: carga PDFs ISUS del mismo alumno, **indica Grupo y Tutor/a**, selecciona evaluaciones.
   - Paso 2: elige perfil (pendientes / repetición / ambos).
   - Paso 3: revisa criterios de recuperación.
   - Paso 4: marca actividades, recursos, agrupamientos, instrumentos.
   - Pulsa **Generar PRA** → se descarga el PDF y se guarda en Firebase
     bajo el curso académico actual.
3. **Ver PRAs guardados**: menú de usuario → **PRAs guardados**. Filtra por
   curso académico. Click en el icono de ojo para regenerar el PDF. Los
   admins pueden borrar PRAs.

## Actualizar la versión (chip dinámico)

Edita `sw.js` y cambia `APP_VERSION`:

```js
const APP_VERSION = 'v1.2.0-20261101';
```

Al recargar la página, el SW se actualiza, se activa y el chip del header
muestra la nueva versión automáticamente (gracias al mensaje `SW_ACTIVATED`
que envía a todas las pestañas abiertas).

## Notas de seguridad

- Las cuentas Firebase Auth **no se pueden borrar desde el cliente** (requiere
  Admin SDK). Cuando "eliminas" un usuario desde la UI, se borra su metadata
  en `/users/{uid}`; el usuario no podrá iniciar sesión porque la app busca
  su perfil en la BD antes de permitir el acceso.
- Para borrar cuentas del todo, usa la consola de Firebase → Authentication →
  Users → Delete.
- Si necesitas re-inicializar el admin (porque olvidaste la contraseña):
  1. Borra `meta/adminInitialized` en la BD.
  2. Borra o reescribe el usuario en Authentication.
  3. Recarga la app: aparecerá el formulario de setup de nuevo.
