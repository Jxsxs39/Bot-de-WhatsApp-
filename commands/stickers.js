import {
  convertAudioStickerAudio,
  createStickerMedia,
  downloadStickerMedia,
  getAudioMediaSource,
  getStickerMediaSource,
  StickerMediaError
} from '../sticker-media.js';
import { sendAudioSticker } from '../audio-sticker.js';

const SESSION_SECONDS = 60;
const MAX_ACTIVE_GENERATIONS = 1;
const audioStickerSessions = new Map();
let activeGenerations = 0;

function sessionKey(ctx) {
  return `${ctx.chatId}:${ctx.userId}`;
}

function clearSession(key) {
  const session = audioStickerSessions.get(key);
  if (session?.timer) clearTimeout(session.timer);
  audioStickerSessions.delete(key);
}

function startAudioStickerSession(ctx, sticker) {
  const key = sessionKey(ctx);
  clearSession(key);
  const timer = setTimeout(() => {
    if (!audioStickerSessions.has(key)) return;
    audioStickerSessions.delete(key);
    ctx.reply('⌛ La sesión para añadir audio terminó. Vuelve a usar .s1 con la foto para intentarlo otra vez.')
      .catch(error => console.error('[STICKER] No se pudo avisar del vencimiento:', error?.name || 'Error'));
  }, SESSION_SECONDS * 1000);
  timer.unref?.();
  audioStickerSessions.set(key, {
    sticker,
    isAnimated: false,
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
    timer,
    processing: false
  });
}

export async function withGenerationNotice(ctx, operation) {
  if (activeGenerations >= MAX_ACTIVE_GENERATIONS) {
    await ctx.reply('⏳ El bot está procesando otro sticker para ahorrar recursos. Inténtalo de nuevo en un momento.');
    return false;
  }
  activeGenerations++;
  let notice;
  try {
    notice = await ctx.reply('⏳ Tu sticker se está generando…');
    return await operation();
  } finally {
    if (notice?.key) {
      try {
        await ctx.sock.sendMessage(ctx.chatId, { delete: notice.key });
      } catch (error) {
        console.error('[STICKER] No se pudo borrar el aviso de generación:', error?.name || 'Error');
      }
    }
    activeGenerations--;
  }
}

async function completeAudioSticker(ctx, session, source) {
  const key = sessionKey(ctx);
  if (session.processing) {
    await ctx.reply('⏳ Ya estoy preparando el audio de esta sesión.');
    return true;
  }
  session.processing = true;
  try {
    await withGenerationNotice(ctx, async () => {
      const audioBuffer = await downloadStickerMedia(source, ctx.sock);
      const { audio, duration } = await convertAudioStickerAudio(audioBuffer, source.mimetype);
      await ctx.replyWithAudioSticker(session.sticker, session.isAnimated, audio, duration);
      clearSession(key);
      await ctx.reply('✨ ¡Tu audio sticker está listo! Toca el sticker para escuchar el audio.');
    });
  } catch (error) {
    session.processing = false;
    if (error instanceof StickerMediaError) {
      console.error('[AUDIO STICKER]', error.code, error.message);
      await ctx.reply(error.userMessage);
    } else {
      console.error('[AUDIO STICKER] No se pudo enviar:', error?.name || 'Error');
      await ctx.reply('No pude enviar el audio sticker. Inténtalo otra vez con otro audio.');
    }
  }
  return true;
}

export async function handlePendingAudioSticker(ctx) {
  const key = sessionKey(ctx);
  const session = audioStickerSessions.get(key);
  if (!session) return false;
  if (Date.now() >= session.expiresAt) {
    clearSession(key);
    return false;
  }
  const source = getAudioMediaSource(ctx.rawMessage);
  if (!source) return false;
  await completeAudioSticker(ctx, session, source);
  return true;
}

async function createSticker(ctx, includeAudio) {
  const key = sessionKey(ctx);
  const pending = includeAudio ? audioStickerSessions.get(key) : null;
  if (includeAudio && ctx.args.join(' ').trim().toLowerCase() === 'cancelar') {
    if (!pending) return ctx.reply('No tienes una sesión de audio sticker activa.');
    clearSession(key);
    return ctx.reply('✅ Sesión de audio sticker cancelada.');
  }
  if (pending) {
    const audioSource = getAudioMediaSource(ctx.rawMessage);
    if (audioSource) return completeAudioSticker(ctx, pending, audioSource);
  }

  const source = getStickerMediaSource(ctx.rawMessage);
  if (!source) {
    return ctx.reply(includeAudio
      ? 'Responde a un video con .s1 para crear un sticker con sonido. Para una foto, usa .s1 y luego envía o responde con un audio en menos de 60 segundos.'
      : 'Responde a una foto o video con .s2 o envíalo con .s2 en el caption.');
  }

  await withGenerationNotice(ctx, async () => {
    try {
      const buffer = await downloadStickerMedia(source, ctx.sock);
      const result = await createStickerMedia(buffer, source.type, includeAudio);
      if (includeAudio && source.type === 'image') {
        startAudioStickerSession(ctx, result.sticker);
        return ctx.reply('🖼️ Foto lista para sticker. Envía un audio o responde a uno en los próximos 60 segundos; duración máxima 25 segundos. Usa .s1 cancelar para detener la sesión.');
      }

      if (includeAudio && result.audio) {
        await ctx.replyWithAudioSticker(result.sticker, true, result.audio, result.duration);
        return;
      }

      await ctx.replyWithSticker(result.sticker, source.type === 'video');
      if (includeAudio) {
        await ctx.reply('El video no tenía audio; envié el sticker animado sin sonido.');
      }
    } catch (error) {
      if (!(error instanceof StickerMediaError)) throw error;
      console.error('[STICKER]', error.code, error.message, error.details || '');
      await ctx.reply(error.userMessage);
    }
  });
}

export default [
  { name: 's1', async run(ctx) { await createSticker(ctx, true); } },
  { name: 's2', async run(ctx) { await createSticker(ctx, false); } }
];
