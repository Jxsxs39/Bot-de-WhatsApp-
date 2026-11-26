import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadMediaMessage, normalizeMessageContent } from '@whiskeysockets/baileys';
import pino from 'pino';

const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MAX_STATIC_STICKER_BYTES = 100 * 1024;
const MAX_ANIMATED_STICKER_BYTES = 500 * 1024;
const MAX_VIDEO_SECONDS = 5;
const mediaLogger = pino({ level: 'silent' });

export class StickerMediaError extends Error {
  constructor(code, message, userMessage = message) {
    super(message);
    this.name = 'StickerMediaError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

function mediaType(content) {
  if (content?.imageMessage) return 'image';
  if (content?.videoMessage) return 'video';
  return null;
}

export function getStickerMediaSource(msg) {
  const content = normalizeMessageContent(msg?.message);
  const directType = mediaType(content);
  if (directType) return { type: directType, message: { ...msg, message: content } };

  const contextInfo = Object.values(content || {})
    .find(part => part && typeof part === 'object' && part.contextInfo?.quotedMessage)
    ?.contextInfo;
  if (!contextInfo) return null;

  const quotedContent = normalizeMessageContent(contextInfo.quotedMessage);
  const quotedType = mediaType(quotedContent);
  if (!quotedType) return null;

  return {
    type: quotedType,
    message: {
      ...msg,
      key: {
        ...msg.key,
        id: contextInfo.stanzaId || msg.key?.id,
        participant: contextInfo.participant
      },
      message: quotedContent
    }
  };
}

export async function downloadStickerMedia(source, sock) {
  const stream = await downloadMediaMessage(source.message, 'stream', {}, {
    logger: mediaLogger,
    reuploadRequest: message => sock.updateMediaMessage(message)
  });
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > MAX_MEDIA_BYTES) {
      stream.destroy();
      throw new StickerMediaError(
        'MEDIA_TOO_LARGE',
        'Input media exceeded the processing limit',
        'El archivo supera el límite de 16 MB. Envía uno más pequeño.'
      );
    }
    chunks.push(chunk);
  }
  if (!total) throw new StickerMediaError('EMPTY_MEDIA', 'Downloaded media was empty', 'No pude descargar ese archivo.');
  return Buffer.concat(chunks, total);
}

function run(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-4096); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
    child.once('error', error => {
      if (error.code === 'ENOENT') {
        finish(reject, new StickerMediaError(
          'FFMPEG_MISSING',
          `${program} is not installed`,
          'El hosting necesita FFmpeg instalado para crear stickers. Instálalo y reinicia el bot.'
        ));
        return;
      }
      finish(reject, error);
    });
    child.once('close', code => {
      if (code === 0) {
        finish(resolve, { stdout, stderr });
        return;
      }
      const error = new StickerMediaError(
        'CONVERSION_FAILED',
        `${program} exited with code ${code}`,
        'No pude convertir el archivo. Prueba con una foto o un video MP4 más corto.'
      );
      error.details = stderr;
      finish(reject, error);
    });
    timer = setTimeout(() => {
      child.kill();
      finish(reject, new StickerMediaError(
        'PROCESS_TIMEOUT',
        `${program} exceeded the processing time limit`,
        'La conversión tardó demasiado. Prueba con un archivo más corto.'
      ));
    }, 30_000);
  });
}

export async function createStickerMedia(buffer, type, includeAudio = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'whatsapp-sticker-'));
  const inputPath = path.join(directory, 'input');
  const stickerPath = path.join(directory, 'sticker.webp');
  const audioPath = path.join(directory, 'audio.ogg');
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    await writeFile(inputPath, buffer);
    let hasAudio = false;
    if (type === 'video' && includeAudio) {
      const probe = await run(process.env.FFPROBE_PATH || 'ffprobe', [
        '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type',
        '-of', 'csv=p=0', inputPath
      ]);
      hasAudio = Boolean(probe.stdout.trim());
    }

    const scale = 'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=yuva420p';
    const stickerLimit = type === 'video' ? MAX_ANIMATED_STICKER_BYTES : MAX_STATIC_STICKER_BYTES;
    const qualities = type === 'video' ? ['40', '25', '15'] : ['55', '40', '25'];
    let stickerSize = Infinity;
    for (const quality of qualities) {
      const videoFilter = type === 'video' ? `fps=8,${scale}` : scale;
      const args = [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
        ...(type === 'video' ? ['-t', String(MAX_VIDEO_SECONDS)] : ['-frames:v', '1']),
        '-vf', videoFilter, '-an',
        '-c:v', type === 'video' ? 'libwebp_anim' : 'libwebp',
        '-quality', quality,
        '-compression_level', '6',
        ...(type === 'video' ? ['-loop', '0'] : []),
        '-f', 'webp', stickerPath
      ];
      await run(ffmpeg, args);
      stickerSize = (await stat(stickerPath)).size;
      if (stickerSize <= stickerLimit) break;
    }
    if (stickerSize > stickerLimit) {
      throw new StickerMediaError(
        'STICKER_TOO_LARGE',
        'Converted sticker exceeded WhatsApp size limits',
        'El sticker quedó muy pesado. Usa una imagen más simple o un video de menos de 5 segundos.'
      );
    }

    let audio = null;
    if (hasAudio) {
      await run(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
        '-map', '0:a:0', '-vn', '-t', String(MAX_VIDEO_SECONDS),
        '-c:a', 'libopus', '-b:a', '64k', '-ac', '1', '-ar', '48000', '-f', 'ogg', audioPath
      ]);
      audio = await readFile(audioPath);
    }
    return { sticker: await readFile(stickerPath), audio };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
