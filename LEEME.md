# Gastos Casa

App web de control de gastos del hogar (PWA). Sube TODOS estos ficheros a la raíz del sitio:

index.html, app.js, sw.js, manifest.json, icon.svg, icon-192.png, icon-512.png,
icon-maskable-512.png, apple-touch-icon.png

La configuración de Firebase ya va dentro de app.js. Solo hace falta el código de hogar.

## Actualizar la app
Si cambias algún fichero, sube el número de `CACHE` en sw.js (gastos-v3 → gastos-v4)
para que los móviles descarguen la versión nueva.

## Reglas de Firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /households/{hid} {
      allow read, write: if request.auth != null;
    }
  }
}
