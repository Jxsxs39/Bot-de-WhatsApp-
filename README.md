# 👑 Historia Reiss Bot

Bot de WhatsApp inspirado en Attack on Titan. En desarrollo.

## Cómo arrancar desde cero
Instala Git y Node.js 22 LTS. En Termux: `pkg install nodejs-lts git` (si no está disponible, usa nodejs compatible). Comprueba con `node -v` y `npm -v`.

```bash
git clone -b main https://github.com/Jxsxs39/Bot-de-WhatsApp-.git historia-bot
cd historia-bot
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
.menu, .historia, .dato, .perfil, .stats, .calc, .work, .daily, .tienda, .comprar, .inventario, .equipar, .ping, .tt, .chatgpt, .pin, .img, .tag, .s1, .s2. Los owners pueden ver administración con `.admin` y subbots con `.code`.
Work tiene espera de 5 minutos y daily de 24 horas. Los juegos todavía no están implementados; los comandos administrativos se consultan con `.admin`.
También se aceptan comandos con prefijo `.` enviados desde la cuenta vinculada; sus mensajes propios sin prefijo se ignoran para evitar respuestas en bucle.

`.ping` confirma que el bot está activo. `.tt <enlace>` valida enlaces de TikTok y recuerda usar la descarga oficial si el creador la habilitó; no descarga contenido automáticamente.

`.calc <operación>` resuelve sumas, restas, multiplicaciones, divisiones, porcentajes y potencias; acepta paréntesis y decimales con punto o coma. Para calcular un porcentaje de una cantidad, escribe, por ejemplo, `.calc 30%30000` (resultado: 9000).

La economía incluye una tienda de títulos cosméticos: consulta `.tienda`, compra con `.comprar <id>`, revisa tus artículos con `.inventario` y equipa uno con `.equipar <id>` (o quítalo con `.equipar ninguno`). Las compras se guardan por usuario y el título equipado aparece en `.perfil`.

`.pin <contexto>` busca hasta tres fotos relacionadas en Wikimedia Commons y complementa los resultados con Wikipedia y Bing Imágenes cuando hace falta. Envía las imágenes sin texto ni pies de foto. También se acepta `.pinterest <contexto>`.

`.img <descripción>` genera una imagen gratis a través de AI Horde, una red comunitaria de equipos voluntarios. Puede tardar hasta tres minutos según la cola y solo genera una imagen de 512 × 512 por solicitud. Las solicitudes pueden compartirse con el servicio; no incluyas información privada. Hay un límite de una solicitud por usuario cada minuto.

`.tag <mensaje>` envía solo el texto y usa la mención general nativa de WhatsApp, sin añadir los nombres o números de los integrantes al mensaje. Solo está disponible para administradores del grupo.

`.chatgpt <pregunta>` consulta la API de OpenAI y responde con una personalidad cálida inspirada en Historia Reiss. Configura `OPENAI_API_KEY` en las variables del hosting; opcionalmente, `OPENAI_MODEL` cambia el modelo (por defecto `gpt-4o-mini`). El texto después del comando se envía a OpenAI y el uso de la API puede tener costo. Cada consulta es independiente y admite hasta 4.000 caracteres.

`.s1` crea un audio sticker: con un video combina el sticker animado y su audio, con un máximo de 25 segundos; con una foto abre una sesión de 60 segundos para enviar o responder con un audio de hasta 25 segundos. Usa `.s1 cancelar` para cerrar la sesión. `.s2` crea un sticker sin audio desde una foto o video y recorta videos a 5 segundos. Responde al medio con el comando o envíalo como caption; los medios deben pesar menos de 16 MB. Si la conversión tarda demasiado o el sticker excede el tamaño permitido, el bot reintenta con videos más cortos. FFmpeg y ffprobe deben estar disponibles en el hosting; el runtime nativo de Render los incluye.

El comando `.menu` muestra un banner de Historia Reiss junto con los comandos generales; los comandos administrativos se consultan con `.admin`. Las respuestas usan un marco visual con emojis y su tono cálido y regio. Los comandos `.getcode` y `.logs` conservan su salida sin adornos para que el código y los registros sigan siendo legibles. El bot requiere `@rexxhayanasi/elaina-baileys` 1.4.7, que incluye los campos Protobuf nativos para audio stickers.

`.code` genera un código para vincular la propia cuenta como subbot. Por seguridad, solo se puede solicitar en un chat privado y el código no debe compartirse. El owner principal y los owners delegados (admins del bot) pueden controlar solicitudes con `.code on`, `.code off`, consultar sesiones con `.code status` y limpiar credenciales antiguas de una cuenta desconectada con `.code reset <número>`. El reinicio se rechaza si la sesión indicada sigue en línea. Desactivar `.code` invalida las vinculaciones pendientes, pero no desconecta los subbots existentes. Las sesiones se guardan en `sesion_subbots/`, así que configura almacenamiento persistente en el hosting.

## Seguridad
Desvincula inmediatamente la sesión que se publicó anteriormente desde WhatsApp. Crea una nueva. Borrar archivos de una rama no borra el historial Git ni las copias existentes. No reutilices las credenciales publicadas. No subas node_modules, sesiones, bases de datos ni .env. Antes de actualizar, respalda tus datos localmente y no uses la misma sesión en dos procesos. Las estadísticas antiguas guardadas por grupo no se pueden repartir automáticamente entre participantes.

## Cómo agregar un comando
Lee docs/APRENDER.md. Trabaja en test, ejecuta npm test y prueba en un grupo propio antes de integrar a main.

## Despliegue en Render
Configura WHATSAPP_PHONE con tu número internacional sin + en Environment. Usa Node 22 o 24, Build Command `npm install && npm rebuild sqlite3 --build-from-source` y Start Command `npm start`. El proyecto permite los scripts de instalación requeridos por Baileys, protobufjs y sqlite3. Si desvinculas WhatsApp, al reiniciar el bot limpiará las credenciales vencidas y mostrará un nuevo código de vinculación. El servidor HTTP se activa cuando Render proporciona PORT; solo indica que el proceso está activo, no que WhatsApp esté conectado. La sesión debe guardarse en almacenamiento persistente para sobrevivir a nuevos despliegues. No compartas códigos de vinculación.

## Administración experimental
Configura BOT_OWNER_JIDS con JIDs autorizados separados por comas (número internacional@s.whatsapp.net o LID exacto). Usa otra cuenta autorizada en chat privado con el bot. El prefijo actual es `.`. `.getcode archivo.js`, `.savefile archivo.js` o `.setcode archivo.js` citando código, `.test archivo.js` (solo sintaxis), `.update` (hook privado RENDER_DEPLOY_HOOK), `.restart` (reconecta WhatsApp sin apagar el servidor). Los borradores no se ejecutan ni se publican; Render gratuito puede perderlos. No guardes secretos en GitHub.

### Prioridad administrativa
El owner principal fijo tiene prioridad 100 y no puede ser eliminado. Los owners delegados tienen prioridad 90; solo el principal puede usar `.setowner` y `.delowner`. Los comandos sensibles se limitan a chats privados; desde la cuenta vinculada, usa el chat contigo mismo. BOT_OWNERS_FILE permite ubicar la lista en almacenamiento persistente. Render gratuito puede perder la lista local.

### Edición directa de comandos
Cualquier owner autorizado puede responder a código JavaScript completo con `.setcode general.js` o `.savefile general.js`. Se valida sintaxis, se conserva un respaldo y se reemplaza el archivo activo. `.reload` carga el cambio; `.rollback general.js` restaura el respaldo y después se usa `.reload`. `.test general.js` sobre código citado solo valida sintaxis. Archivos permitidos: general.js, economy.js, stickers.js. Los cambios locales no se sincronizan con GitHub y pueden perderse en Render gratuito. La validación sintáctica no garantiza comportamiento correcto.

Todos los owners comparten permisos de operación y edición de código. Solo el principal administra la lista de owners.
