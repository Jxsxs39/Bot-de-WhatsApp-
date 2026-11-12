import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import readline from 'readline';
import Database from './database.js';
import { createCommandHandler } from './handler.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

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

    const db = new Database();
    await db.init();

    const commandHandler = createCommandHandler(sock, db);

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

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            await commandHandler.handleMessage(msg);
        }
    });
}

iniciarBot();
