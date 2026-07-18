# Pruebas

## Web

`node --test tests\*.test.cjs` valida sintaxis, recursos relativos, configuración única, ausencia de credenciales administrativas, reglas de activación, acciones de permisos y tipos de botones.

Además se revisan manualmente escritorio y móvil, modo claro y oscuro, teclado, desbordamiento horizontal, consola y respuestas 404.

## Backend

`node --test tests\*.test.cjs` en `_private/backend-apps-script` cubre sintaxis, catálogo cerrado, Premium completo, permiso manual para Free, expiración, suspensión, revocación y límites de dispositivos.

## Flutter

Ejecutar en este orden:

```powershell
flutter clean
flutter pub get
dart format .
flutter analyze
flutter test
```

Las pruebas incluyen repositorios locales, cálculos, navegación, temas, caché de licencia, gracia sin conexión, permisos parciales y el distintivo Premium con texto ampliado. Antes de publicar, comprobar también Android y Windows reales; iOS requiere firma y validación en herramientas Apple.
