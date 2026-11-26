# 👑 Historia Reiss Bot

Bot de WhatsApp inspirado en Attack on Titan. En desarrollo.

## Cómo arrancar desde cero
Instala Git y Node.js 22 LTS. En Termux: `pkg install nodejs-lts git` (si no está disponible, usa nodejs compatible). Comprueba con `node -v` y `npm -v`.

```bash
git clone -b test https://github.com/Jxsxs39/Bot-de-WhatsApp-.git historia-test
cd historia-test
npm install
npm test
npm start
```

En el primer inicio escribe tu número internacional sin +. En WhatsApp abre Dispositivos vinculados y elige vincular con número de teléfono. Introduce el código mostrado en tu terminal. No compartas ese código. Para detener el bot pulsa Ctrl+C. Para volver a arrancar usa npm start; no necesitas vincular cada vez.

Si sqlite3 necesita compilarse en Termux, instala python, make y clang. Si falla, conserva el mensaje de error para diagnosticarlo.

## Archivos
- index.js: arranca WhatsApp, recibe eventos y controla reconexiones.
- handler.js: interpreta el prefijo ., separa chat y usuario, ejecuta comandos.
- database.js: guarda monedas, XP y estadísticas en SQLite.
- commands/: comandos separados por función.
- package.json: dependencias y scripts. package-lock.json fija las versiones verificadas; conserva el archivo en Git y actualízalo junto con package.json.
- .gitignore: evita publicar archivos privados o generados.

## Comandos
.hola, .menu, .historia, .dato, .perfil, .stats, .work, .daily.
Work tiene espera de 5 minutos y daily de 24 horas. Los juegos, stickers y administración todavía no están implementados.
También se aceptan comandos con prefijo `.` enviados desde la cuenta vinculada; sus mensajes propios sin prefijo se ignoran para evitar respuestas en bucle.

## Seguridad
Desvincula inmediatamente la sesión que se publicó anteriormente desde WhatsApp. Crea una nueva. Borrar archivos de una rama no borra el historial Git ni las copias existentes. No reutilices las credenciales publicadas. No subas node_modules, sesiones, bases de datos ni .env. Antes de actualizar, respalda tus datos localmente y no uses la misma sesión en dos procesos. Las estadísticas antiguas guardadas por grupo no se pueden repartir automáticamente entre participantes.

## Cómo agregar un comando
Lee docs/APRENDER.md. Trabaja en test, ejecuta npm test y prueba en un grupo propio antes de integrar a main.

## Despliegue en Render
Configura WHATSAPP_PHONE con tu número internacional sin + en Environment. Usa Node 22, Build Command `npm install && npm rebuild sqlite3 --build-from-source` y Start Command `npm start`. El servidor HTTP se activa cuando Render proporciona PORT; solo indica que el proceso está activo, no que WhatsApp esté conectado. La sesión debe guardarse en almacenamiento persistente para sobrevivir a nuevos despliegues. No compartas códigos de vinculación.
