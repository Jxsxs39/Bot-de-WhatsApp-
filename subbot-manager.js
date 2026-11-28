import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from '@rexxhayanasi/elaina-baileys';
import pino from 'pino';
import { clearWhatsAppAuthState } from './whatsapp-session.js';

const PHONE_PATTERN = /^\d{8,15}$/;
const PAIRING_TIMEOUT_MS = 3 * 60 * 1000;

function phoneFromJid(jid) {
  const match = /^(\d{8,15})@s\.whatsapp\.net$/.exec(jid || '');
  return match?.[1];
}

function normalizeJid(jid) {
  return typeof jid === 'string' ? jid.replace(/:\d+@/, '@') : undefined;
}

export class SubbotManager {
  constructor({
    createCommandHandler,
    dispatchMessage,
    authDirectory = process.env.SUBBOT_SESSIONS_DIR || 'sesion_subbots',
    settingsFile = process.env.SUBBOT_SETTINGS_FILE || 'data/subbots.json',
    makeSocket = makeWASocket,
    loadAuthState = useMultiFileAuthState,
    getBaileysVersion = fetchLatestBaileysVersion,
    logger = console
  }) {
    this.createCommandHandler = createCommandHandler;
    this.dispatchMessage = dispatchMessage;
    this.authDirectory = authDirectory;
    this.settingsFile = settingsFile;
    this.makeSocket = makeSocket;
    this.loadAuthState = loadAuthState;
    this.getBaileysVersion = getBaileysVersion;
    this.logger = logger;
    this.codeEnabled = true;
    this.connections = new Map();
    this.connecting = new Set();
    this.settingsQueue = Promise.resolve();
    this.retryAttempts = new Map();
    this.reconnectTimers = new Map();
    this.stopping = false;
    this.started = false;
  }

  async start() {
    if (this.started) return;
    await mkdir(this.authDirectory, { recursive: true, mode: 0o700 });
    await this.loadSettings();
    this.started = true;

    const entries = await readdir(this.authDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !PHONE_PATTERN.test(entry.name)) continue;
      try {
        await this.connectSession(entry.name);
      } catch (error) {
        this.logger.error('[SUBBOT] No se pudo restaurar una sesión:', error?.name ?? 'Error');
      }
    }
  }

  async loadSettings() {
    try {
      const settings = JSON.parse(await readFile(this.settingsFile, 'utf8'));
      if (!settings || typeof settings.codeEnabled !== 'boolean') {
        throw new Error('Configuración de subbots inválida');
      }
      this.codeEnabled = settings.codeEnabled;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  async setCodeEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled debe ser boolean');
    const operation = this.settingsQueue.then(async () => {
      await mkdir(dirname(this.settingsFile), { recursive: true, mode: 0o700 });
      const temporaryFile = `${this.settingsFile}.tmp`;
      await writeFile(temporaryFile, JSON.stringify({ codeEnabled: enabled }), { mode: 0o600 });
      await rename(temporaryFile, this.settingsFile);
      this.codeEnabled = enabled;
      if (!enabled) {
        for (const entry of [...this.connections.values()]) {
          if (entry.registered) continue;
          try {
            await entry.notifyExpired?.('El comando .code se desactivó y tu código de vinculación quedó invalidado.');
          } catch (error) {
            this.logger.error('[SUBBOT] No se pudo avisar que se canceló la vinculación:', error?.name ?? 'Error');
          }
          this.closeEntry(entry, new Error('Vinculación cancelada por un owner'));
        }
      }
    });
    this.settingsQueue = operation.catch(() => {});
    await operation;
  }

  getStatus() {
    let connected = 0;
    let registered = 0;
    let pending = 0;
    for (const entry of this.connections.values()) {
      if (entry.online) connected++;
      if (entry.registered) registered++;
      else pending++;
    }
    return { codeEnabled: this.codeEnabled, connected, registered, pending };
  }

  refreshConnections() {
    for (const entry of [...this.connections.values()]) {
      if (!entry.registered || !entry.online) continue;
      this.closeEntry(entry, new Error('Renovación programada de conexión'));
      this.scheduleReconnect(entry.phone);
    }
  }

  async requestPairingCode(ctx) {
    if (!this.codeEnabled) return ctx.reply('El comando .code está desactivado temporalmente.');
    if (ctx.chatId?.endsWith('@g.us')) {
      return ctx.reply('Por seguridad, solicita el código .code en un chat privado con el bot.');
    }

    const phone = phoneFromJid(ctx.userId);
    if (!phone) {
      return ctx.reply('No pude verificar tu número de WhatsApp. Usa una cuenta con número visible y vuelve a intentar.');
    }

    const mainPhone = phoneFromJid(normalizeJid(ctx.sock?.user?.id));
    if (phone === mainPhone) return ctx.reply('La cuenta principal ya está vinculada como bot.');

    const existing = this.connections.get(phone);
    if (existing?.registered && existing.online) return ctx.reply('Tu cuenta ya está conectada como subbot.');
    if ((existing?.registered && !existing.online) || this.reconnectTimers.has(phone)) {
      return ctx.reply(`Hay credenciales de una sesión anterior para tu número, pero no está conectada. Pide al owner que ejecute .code reset ${phone}; después vuelve a solicitar .code.`);
    }
    if (existing || this.connecting.has(phone)) {
      return ctx.reply('Ya hay una solicitud de vinculación activa para tu cuenta. Espera o vuelve a intentar más tarde.');
    }

    try {
      const code = await this.connectSession(phone, { requestPairing: true, notifyExpired: ctx.reply });
      if (typeof code !== 'string') {
        return ctx.reply(`Hay credenciales de una sesión anterior para tu número. Pide al owner que ejecute .code reset ${phone}; después vuelve a solicitar .code.`);
      }
      return ctx.reply(`Código de vinculación: *${code}*\nEn WhatsApp abre Dispositivos vinculados → Vincular con número de teléfono. No compartas este código.`);
    } catch (error) {
      this.logger.error('[SUBBOT] No se pudo generar un código:', error?.name ?? 'Error');
      if (error.code === 'CODE_DISABLED' || !this.codeEnabled) {
        return ctx.reply('El comando .code está desactivado temporalmente.');
      }
      if (error.code === 'PAIRING_PENDING') {
        return ctx.reply('Ya hay una solicitud de vinculación activa. Espera o vuelve a intentar más tarde.');
      }
      return ctx.reply('No pude generar el código de vinculación. Inténtalo de nuevo más tarde.');
    }
  }

  async resetSession(phone) {
    if (!PHONE_PATTERN.test(phone || '')) throw new TypeError('Número de subbot inválido');
    if (this.connecting.has(phone)) return { ok: false, reason: 'pending' };
    const entry = this.connections.get(phone);
    if (entry?.online) return { ok: false, reason: 'online' };
    if (entry && !entry.registered) return { ok: false, reason: 'pending' };
    const timer = this.reconnectTimers.get(phone);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(phone);
    }
    this.retryAttempts.delete(phone);
    if (entry) {
      this.closeEntry(entry, new Error('Sesión de subbot reiniciada por un owner'));
      await entry.queue;
    }
    await clearWhatsAppAuthState(join(this.authDirectory, phone));
    return { ok: true };
  }

  async connectSession(phone, { requestPairing = false, notifyExpired } = {}) {
    if (!PHONE_PATTERN.test(phone)) throw new TypeError('Número de subbot inválido');
    if (this.stopping) throw new Error('El administrador de subbots está cerrándose');

    const existing = this.connections.get(phone);
    if (existing) return existing.registered ? { already: true } : null;
    if (this.connecting.has(phone)) {
      const error = new Error('Solicitud de vinculación activa');
      error.code = 'PAIRING_PENDING';
      throw error;
    }

    this.connecting.add(phone);
    let entry;
    try {
      const { state, saveCreds } = await this.loadAuthState(join(this.authDirectory, phone));
      if (requestPairing && !this.codeEnabled) {
        const error = new Error('El comando .code está desactivado');
        error.code = 'CODE_DISABLED';
        throw error;
      }
      if (requestPairing && state.creds.registered) return { already: true };
      if (!state.creds.registered && !requestPairing) return null;

      const { version } = await this.getBaileysVersion();
      if (requestPairing && !this.codeEnabled) {
        const error = new Error('El comando .code está desactivado');
        error.code = 'CODE_DISABLED';
        throw error;
      }
      const sock = this.makeSocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '22.04']
      });

      entry = {
        phone,
        state,
        sock,
        saveCreds,
        registered: Boolean(state.creds.registered),
        online: false,
        queue: Promise.resolve(),
        closed: false,
        notifyExpired,
        handler: this.createCommandHandler(sock)
      };
      this.connections.set(phone, entry);

      let resolveCode;
      let rejectCode;
      const codePromise = requestPairing
        ? new Promise((resolve, reject) => {
            resolveCode = resolve;
            rejectCode = reject;
          })
        : null;
      entry.finishCode = (error, code) => {
        if (entry.codeSettled) return;
        entry.codeSettled = true;
        if (error) rejectCode?.(error);
        else resolveCode?.(code);
      };

      this.attach(entry, requestPairing);
      if (requestPairing && !entry.registered) {
        entry.expirationTimer = setTimeout(() => {
          if (entry.registered) return;
          if (entry.codeSettled) {
            Promise.resolve(entry.notifyExpired?.('El código de subbot venció. Ejecuta .code para solicitar uno nuevo.'))
              .catch(error => this.logger.error('[SUBBOT] No se pudo avisar que venció el código:', error?.name ?? 'Error'));
          }
          this.closeEntry(entry, new Error('Código de vinculación vencido'));
        }, PAIRING_TIMEOUT_MS);
        entry.expirationTimer.unref?.();
        return await codePromise;
      }

      return requestPairing ? { already: true } : entry;
    } catch (error) {
      if (entry) this.closeEntry(entry, error);
      throw error;
    } finally {
      this.connecting.delete(phone);
    }
  }

  attach(entry, requestPairing) {
    const { sock } = entry;
    entry.onCreds = () => {
      entry.queue = entry.queue.then(entry.saveCreds).catch(error => {
        this.logger.error('[SUBBOT] No se pudieron guardar credenciales:', error?.name ?? 'Error');
      });
    };
    entry.onMessages = ({ messages, type }) => {
      if (type !== 'notify' || this.stopping || !entry.registered) return;
      entry.queue = entry.queue.then(async () => {
        for (const message of messages) {
          await this.dispatchMessage(entry.handler, message);
        }
      }).catch(error => {
        this.logger.error('[SUBBOT] Error procesando mensajes:', error?.name ?? 'Error');
      });
    };
    entry.onConnection = ({ connection, lastDisconnect, qr }) => {
      if (entry.closed || this.connections.get(entry.phone) !== entry) return;
      if (qr && requestPairing && !entry.codeRequested) {
        entry.codeRequested = true;
        void sock.requestPairingCode(entry.phone).then(code => {
          if (entry.closed) return;
          if (typeof code !== 'string' || !code) throw new Error('El servidor no devolvió un código de vinculación');
          entry.finishCode(null, code);
        }).catch(error => {
          entry.finishCode(error);
          this.closeEntry(entry, error);
        });
      }
      if (connection === 'open') {
        entry.registered = true;
        entry.online = true;
        clearTimeout(entry.expirationTimer);
        entry.notifyExpired = null;
        this.retryAttempts.delete(entry.phone);
        this.logger.log('[SUBBOT] Sesión conectada.');
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const wasRegistered = entry.registered || Boolean(entry.state.creds.registered);
        entry.online = false;
        this.closeEntry(entry, new Error('Conexión de subbot cerrada'));
        if (
          wasRegistered &&
          !this.stopping &&
          code !== DisconnectReason.loggedOut &&
          code !== DisconnectReason.connectionReplaced
        ) {
          this.scheduleReconnect(entry.phone);
        }
      }
    };
    sock.ev.on('creds.update', entry.onCreds);
    sock.ev.on('messages.upsert', entry.onMessages);
    sock.ev.on('connection.update', entry.onConnection);
  }

  closeEntry(entry, error) {
    if (entry.closed) return;
    entry.closed = true;
    entry.online = false;
    clearTimeout(entry.expirationTimer);
    if (this.connections.get(entry.phone) === entry) this.connections.delete(entry.phone);
    entry.sock.ev.off('creds.update', entry.onCreds);
    entry.sock.ev.off('messages.upsert', entry.onMessages);
    entry.sock.ev.off('connection.update', entry.onConnection);
    entry.finishCode?.(error);
    try {
      entry.sock.end(undefined);
    } catch (closeError) {
      this.logger.error('[SUBBOT] No se pudo cerrar el socket:', closeError?.name ?? 'Error');
    }
  }

  scheduleReconnect(phone) {
    if (this.stopping || this.reconnectTimers.has(phone)) return;
    const attempts = (this.retryAttempts.get(phone) || 0) + 1;
    this.retryAttempts.set(phone, attempts);
    const delay = Math.min(60_000, 2_000 * 2 ** Math.min(attempts - 1, 5));
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(phone);
      if (this.stopping) return;
      void this.connectSession(phone).catch(error => {
        this.logger.error('[SUBBOT] No se pudo reconectar una sesión:', error?.name ?? 'Error');
        this.scheduleReconnect(phone);
      });
    }, delay);
    timer.unref?.();
    this.reconnectTimers.set(phone, timer);
  }

  async shutdown() {
    this.stopping = true;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    const entries = [...this.connections.values()];
    for (const entry of entries) {
      this.closeEntry(entry, new Error('Proceso detenido'));
    }
    await Promise.all(entries.map(entry => entry.queue));
  }
}
