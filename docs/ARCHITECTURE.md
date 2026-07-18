# Arquitectura

La plataforma mantiene responsabilidades separadas aunque la web consolidada se publique desde un único repositorio.

1. La aplicación Flutter guarda los datos financieros en el dispositivo y consulta únicamente licencia, versión y permisos.
2. El sitio público permite registro e inicio de sesión por código de correo, muestra descargas y contenido público.
3. El portal usa una sesión `USER` validada por el backend para perfil, dispositivos y códigos de activación.
4. El panel administrativo usa una sesión `ADMIN`; cada acción sensible vuelve a validar rol, estado, correo autorizado y antigüedad de la sesión.
5. Apps Script aplica autenticación, autorización, límites, auditoría y reglas Premium. Google Sheets es el almacenamiento inicial.

La URL de `/admin/` no es un control de seguridad. El panel no contiene identidad ni contraseña administrativa y toda autorización se decide en Apps Script.

## Límites de confianza

- Navegador: interfaz no confiable; nunca decide permisos finales.
- Flutter: puede conservar permisos firmemente validados durante la gracia sin conexión, pero no asignarlos.
- Apps Script: autoridad para sesiones, cuentas, dispositivos, planes y funciones.
- Sheets y Script Properties: almacenamiento privado del propietario.

Los directorios `admin/`, `portal/` y `shared/` evitan duplicar clientes, validadores y configuración. `_private/` no se publica ni se versiona en este repositorio.
