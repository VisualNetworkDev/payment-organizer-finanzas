# Backend de Apps Script

La API recibe solicitudes `POST` con una acción y devuelve siempre `ok`, `data`, `error` y `correlationId`. Los clientes no toman decisiones de autorización a partir del estado HTTP.

## Autenticación

- Usuarios: códigos de correo de seis dígitos, con hash, expiración, máximo de intentos y límites de frecuencia.
- Portal: token aleatorio; Sheets conserva únicamente su hash.
- Administrador: correo permitido, usuario `ADMIN` activo y verificado, más un verificador de contraseña guardado en Script Properties. La contraseña nunca se guarda en código ni en Sheets.
- Dispositivos: código temporal de un uso y token opaco guardado de forma segura por Flutter.

## Datos

Las hojas separan usuarios, sesiones, códigos, dispositivos, permisos, versiones, configuración, contacto, errores y auditoría. `UserFeatureEntitlements` solo admite claves del catálogo cerrado. Los valores públicos se exponen por un endpoint específico; no se devuelve la configuración completa.

La app no envía balances, pagos, ingresos, deudas, notas ni recordatorios personales al backend.
