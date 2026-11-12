import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// Configuración principal de historia-bot
const PREFIJO = '+';
const BANNER_URL = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR14LHPR9O1f4Bf2ynskYwSOMhrrj3k_8dBGGMA3LOOK_oAu4HF41LyO3KL&s=10';

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_historia');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    // Solicita el código de 8 dígitos si aún no hay sesión guardada
    if (!sock.authState.creds.registered) {
        const numero = await question('Ingresa tu número de WhatsApp (ej. 584121234567): ');
        const numeroLimpio = numero.replace(/[^0-9]/g, '');
        
        setTimeout(async () => {
            try {
                let codigo = await sock.requestPairingCode(numeroLimpio);
                codigo = codigo?.match(/.{1,4}/g)?.join('-') || codigo;
                console.log(`\n🔑 Tu código de vinculación para historia-bot es: ${codigo}\n`);
            } catch (error) {
                console.error('Error al generar el código:', error);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const debeReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. ¿Reconectando?:', debeReconectar);
            if (debeReconectar) {
                iniciarBot();
            } else {
                console.log('Sesión cerrada. Borra la carpeta "sesion_historia" para vincular de nuevo.');
            }
        } else if (connection === 'open') {
            console.log('✅ ¡historia-bot está conectado con el prefijo (+) y su banner listo!');
            rl.close();
        }
    });

    // Escucha y responde a los mensajes entrantes
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        
        // Ignora mensajes sin contenido o estados
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const remitente = msg.key.remoteJid;
        const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        // Verifica que el mensaje empiece con el prefijo '+'
        if (!texto.startsWith(PREFIJO)) return;

        const args = texto.slice(PREFIJO.length).trim().split(/ +/);
        const comando = args.shift().toLowerCase();

        // Comando +hola
        if (comando === 'hola') {
            await sock.sendMessage(remitente, { 
                text: `¡Hola! Soy *historia-bot* 📖.\nEscribe *${PREFIJO}menu* para ver mi panel principal.` 
            });
        }

        // Comando +menu con tu imagen de banner
        if (comando === 'menu') {
            await sock.sendMessage(remitente, { 
                image: { url: BANNER_URL },
                caption: `👑 *MENÚ DE HISTORIA-BOT* 👑\n\n` +
                         `• *${PREFIJO}hola* - Saludo de bienvenida\n` +
                         `• *${PREFIJO}historia* - Lee un relato corto\n` +
                         `• *${PREFIJO}dato* - Un dato curioso de la historia`
            });
        }

        // Comando +historia
        if (comando === 'historia') {
            await sock.sendMessage(remitente, { 
                text: '📖 *El Relojero del Tiempo*\n\nEn un pequeño pueblo escondido entre montañas, existía un reloj que no marcaba las horas, sino los recuerdos olvidados de quienes pasaban frente a él...' 
            });
        }

        // Comando +dato
        if (comando === 'dato') {
            await sock.sendMessage(remitente, { 
                text: '🏛️ *Dato Histórico:* La Universidad de Oxford es más antigua que el Imperio Azteca. La enseñanza allí comenzó alrededor del año 1096, mientras que Tenochtitlán se fundó en 1325.' 
            });
        }
    });
}

iniciarBot();

