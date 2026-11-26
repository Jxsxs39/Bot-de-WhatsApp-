# Notas para aprender

1. npm install descarga las librerías de package.json; npm start ejecuta index.js.
2. Un socket es la conexión con WhatsApp. Los eventos avisan cuando llegan mensajes o cambia la conexión.
3. async/await permite esperar operaciones de red y base de datos sin bloquear todo el proceso.
4. chatId indica dónde responder; userId indica a quién pertenecen las monedas. Nunca uses el ID de un grupo como usuario.
5. Cada comando exporta un objeto con name y run. Añade su importación al registro de commands/index.js. El menú se genera automáticamente; los comandos se ejecutan con prefijo punto, por ejemplo .ping.
6. Ejemplo: export default { name: 'ping', async run({reply}) { await reply('pong'); } };
7. SQLite usa parámetros ? para separar datos del SQL. Los premios se aplican en una única actualización condicional para evitar duplicados.
8. Para actualizar: detén el bot, ejecuta git pull --ff-only, npm install, npm test y npm start. No borres la sesión ni la base de datos para actualizar.
9. git status muestra cambios. git add selecciona archivos y git commit guarda una versión. Revisa siempre qué vas a subir. No uses git add -f con datos privados.
10. Si falla npm start, copia el error sin incluir números, credenciales ni códigos de vinculación.

La rama test no es una versión estable hasta probar la conexión real.
