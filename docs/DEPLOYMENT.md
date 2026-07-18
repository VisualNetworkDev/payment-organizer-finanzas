# Despliegue

## Orden seguro

1. Crear o verificar la copia de respaldo y ejecutar las pruebas del backend.
2. Ejecutar `migrateSchema()` desde el editor propietario de Apps Script.
3. Actualizar el despliegue web existente a la versión aprobada, conservando su URL, ejecutando como propietario y con el acceso público requerido por los clientes.
4. Comprobar `getPublicConfig`, autenticación, portal, activación y administración contra esa URL.
5. Ejecutar `node --test tests\*.test.cjs` en este repositorio.
6. Fusionar la rama aprobada en `main`. GitHub Actions publica exclusivamente los archivos de `_site`.
7. Verificar `/`, `/portal/`, `/admin/`, privacidad, términos, recursos y respuesta 404.

## Reversión

- Backend: volver el mismo despliegue a la última versión conocida; no crear una URL distinta durante una emergencia.
- Web: revertir el commit de `main` y dejar que Pages vuelva a publicar.
- Flutter: no borrar datos locales. Si una licencia falla, solo se bloquean las funciones avanzadas.

Las compilaciones iOS sin firma pueden conservarse como artefactos técnicos, pero no deben anunciarse como instalación pública. La distribución normal a terceros exige un método autorizado por Apple.
