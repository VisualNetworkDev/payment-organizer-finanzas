# Flujo Premium

1. El usuario crea y verifica su cuenta web.
2. Un administrador asigna Premium, fechas, límite de dispositivos o permisos individuales.
3. El portal muestra solo el acceso efectivo y permite generar un código si la cuenta, el plan, las fechas y el límite lo permiten.
4. Flutter genera un identificador aleatorio de instalación y canjea el código una sola vez.
5. Apps Script registra el dispositivo y entrega un token opaco; solo su hash queda en el backend.
6. Flutter valida periódicamente plan, estado, versión mínima y mapa de funciones.

La prioridad efectiva es: cuenta activa, luego Premium vigente o permiso manual. Suspender, deshabilitar, revocar o eliminar una cuenta bloquea todas las funciones. Retirar Premium no borra registros locales.

Sin conexión se conserva el último mapa validado durante el período de gracia configurado. Vencida la gracia, los datos básicos siguen visibles y solo se bloquean las funciones que necesitan licencia.
