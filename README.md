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
.hola, .menu, .historia, .dato, .perfil, .stats, .work, .daily, .s1, .s2.
Work tiene espera de 5 minutos y daily de 24 horas. Los juegos y la administración todavía no están implementados.
También se aceptan comandos con prefijo `.` enviados desde la cuenta vinculada; sus mensajes propios sin prefijo se ignoran para evitar respuestas en bucle.

`.s1` crea un sticker animado desde un video y envía el audio como mensaje aparte, porque WhatsApp no admite sonido dentro de los stickers. `.s2` crea un sticker sin audio desde una foto o video. Responde al medio con el comando o envíalo como caption; los videos se limitan a 5 segundos y 16 MB. FFmpeg y ffprobe deben estar disponibles en el hosting; el runtime nativo de Render los incluye.

## Seguridad
Desvincula inmediatamente la sesión que se publicó anteriormente desde WhatsApp. Crea una nueva. Borrar archivos de una rama no borra el historial Git ni las copias existentes. No reutilices las credenciales publicadas. No subas node_modules, sesiones, bases de datos ni .env. Antes de actualizar, respalda tus datos localmente y no uses la misma sesión en dos procesos. Las estadísticas antiguas guardadas por grupo no se pueden repartir automáticamente entre participantes.

## Cómo agregar un comando
Lee docs/APRENDER.md. Trabaja en test, ejecuta npm test y prueba en un grupo propio antes de integrar a main.

## Despliegue en Render
Configura WHATSAPP_PHONE con tu número internacional sin + en Environment. Usa Node 22, Build Command `npm install && npm rebuild sqlite3 --build-from-source` y Start Command `npm start`. El servidor HTTP se activa cuando Render proporciona PORT; solo indica que el proceso está activo, no que WhatsApp esté conectado. La sesión debe guardarse en almacenamiento persistente para sobrevivir a nuevos despliegues. No compartas códigos de vinculación.

## Administración experimental
Configura BOT_OWNER_JIDS con JIDs autorizados separados por comas (número internacional@s.whatsapp.net o LID exacto). Usa otra cuenta autorizada en chat privado con el bot. El prefijo actual es `.`. `.getcode archivo.js`, `.savefile archivo.js` o `.setcode archivo.js` citando código, `.test archivo.js` (solo sintaxis), `.update` (hook privado RENDER_DEPLOY_HOOK), `.restart` (confirmación). Los borradores no se ejecutan ni se publican; Render gratuito puede perderlos. No guardes secretos en GitHub.

### Prioridad administrativa
El owner principal fijo tiene prioridad 100 y no puede ser eliminado. Los owners delegados tienen prioridad 90; solo el principal puede usar `.setowner` y `.delowner`. Los comandos sensibles se limitan a chats privados; desde la cuenta vinculada, usa el chat contigo mismo. BOT_OWNERS_FILE permite ubicar la lista en almacenamiento persistente. Render gratuito puede perder la lista local.

### Edición directa de comandos
El owner principal puede responder a código JavaScript completo con `.setcode general.js` o `.savefile general.js`. Se valida sintaxis, se conserva un respaldo y se reemplaza el archivo activo. `.reload` carga el cambio; `.rollback general.js` restaura el respaldo y después se usa `.reload`. `.test general.js` sobre código citado solo valida sintaxis. Archivos permitidos: general.js, economy.js, stickers.js. Los cambios locales no se sincronizan con GitHub y pueden perderse en Render gratuito. La validación sintáctica no garantiza comportamiento correcto.
