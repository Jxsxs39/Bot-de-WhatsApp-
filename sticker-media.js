import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadMediaMessage, normalizeMessageContent } from '@rexxhayanasi/elaina-baileys';
import pino from 'pino';

const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MAX_STATIC_STICKER_BYTES = 100 * 1024;
const MAX_ANIMATED_STICKER_BYTES = 500 * 1024;
const MAX_VIDEO_SECONDS = 5;
const VIDEO_DURATION_FALLBACKS = [MAX_VIDEO_SECONDS, 3, 1];
const AUDIO_STICKER_VIDEO_DURATION_FALLBACKS = [25, 10, 5, 3, 1];
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

function quotedContentInfo(content) {
  return Object.values(content || {})
    .find(part => part && typeof part === 'object' && part.contextInfo?.quotedMessage)
    ?.contextInfo;
}

function sourceFromQuotedMessage(msg, quotedContent) {
  return {
    key: {
      ...msg.key,
      remoteJid: msg.key?.remoteJid,
      id: quotedContent.stanzaId || msg.key?.id,
      participant: quotedContent.participant || msg.key?.participant,
      fromMe: false
    },
    message: quotedContent.message
  };
}

export function getStickerMediaSource(msg) {
  const content = normalizeMessageContent(msg?.message);
  const directType = mediaType(content);
  if (directType) return { type: directType, message: { ...msg, message: content } };

  const contextInfo = quotedContentInfo(content);
  if (!contextInfo) return null;

  const quotedContent = normalizeMessageContent(contextInfo.quotedMessage);
  const quotedType = mediaType(quotedContent);
  if (!quotedType) return null;

  return {
    type: quotedType,
    message: sourceFromQuotedMessage(msg, {
      message: quotedContent,
      stanzaId: contextInfo.stanzaId,
      participant: contextInfo.participant
    })
  };
}

export function getAudioMediaSource(msg) {
  const content = normalizeMessageContent(msg?.message);
  if (content?.audioMessage) {
    return {
      mimetype: content.audioMessage.mimetype || 'audio/mpeg',
      message: { ...msg, message: content }
    };
  }

  const contextInfo = quotedContentInfo(content);
  if (!contextInfo) return null;
  const quotedContent = normalizeMessageContent(contextInfo.quotedMessage);
  if (!quotedContent?.audioMessage) return null;
  return {
    mimetype: quotedContent.audioMessage.mimetype || 'audio/mpeg',
    message: sourceFromQuotedMessage(msg, {
      message: quotedContent,
      stanzaId: contextInfo.stanzaId,
      participant: contextInfo.participant
    })
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
      try { stream.destroy(); } catch {}
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

async function encodeOggOpus(inputPath, outputPath, maxDuration, processRunner) {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  try {
    await processRunner(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-fflags', '+genpts', '-i', inputPath, '-vn', '-map', '0:a:0', '-t', String(maxDuration),
      '-map_metadata', '-1', '-af', 'aresample=async=1:first_pts=0,asetpts=N/SR/TB',
      '-avoid_negative_ts', 'make_zero',
      '-c:a', 'libopus', '-b:a', '48k', '-ac', '1', '-ar', '48000', '-f', 'ogg', outputPath
    ]);
    await processRunner(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-i', outputPath, '-map', '0:a:0', '-f', 'null', '-'
    ]);
    const audio = await readFile(outputPath);
    const probe = await processRunner(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration:format=format_name:stream=codec_name,sample_rate,channels',
      '-of', 'json', outputPath
    ]);
    let metadata;
    try {
      metadata = JSON.parse(probe.stdout);
    } catch {
      throw new StickerMediaError('INVALID_AUDIO', 'Converted audio metadata is invalid', 'No pude validar el audio convertido.');
    }
    const duration = Number(metadata.format?.duration);
    const audioStream = metadata.streams?.find(stream => stream.codec_name === 'opus');
    if (
      !Number.isFinite(duration) || duration <= 0 ||
      !String(metadata.format?.format_name || '').split(',').includes('ogg') ||
      !audioStream || Number(audioStream.sample_rate) !== 48000 || Number(audioStream.channels) !== 1 ||
      audio.toString('ascii', 0, 4) !== 'OggS'
    ) {
      throw new StickerMediaError('INVALID_AUDIO', 'Converted audio is not valid mono Opus in Ogg', 'El audio del video está dañado o no es compatible. Prueba con otro video.');
    }
    return { audio, duration: Math.min(duration, maxDuration) };
  } catch (error) {
    if (error instanceof StickerMediaError) throw error;
    throw new StickerMediaError(
      'AUDIO_CONVERSION_FAILED',
      error.message,
      'No pude convertir el audio. Prueba con un archivo de audio compatible.'
    );
  }
}

export async function convertAudioStickerAudio(buffer, mimeType = '', processRunner = run, maxDuration = 25) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new StickerMediaError('EMPTY_MEDIA', 'Downloaded audio was empty', 'No pude descargar ese audio.');
  }
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new StickerMediaError('MEDIA_TOO_LARGE', 'Audio exceeded the processing limit', 'El audio supera el límite de 16 MB.');
  }
  if (!Number.isFinite(maxDuration) || maxDuration <= 0) {
    throw new StickerMediaError('INVALID_DURATION', 'Audio duration limit is invalid');
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), 'whatsapp-audio-sticker-'));
  const normalizedMime = mimeType.toLowerCase();
  const extension = /ogg|opus/.test(normalizedMime) ? '.ogg'
    : /wav/.test(normalizedMime) ? '.wav'
      : /video\//.test(normalizedMime) ? '.mp4'
        : /mp4|m4a|aac/.test(normalizedMime) ? '.m4a' : '.mp3';
  const inputPath = path.join(directory, `input${extension}`);
  const outputPath = path.join(directory, 'audio.ogg');
  try {
    await writeFile(inputPath, buffer);
    return await encodeOggOpus(inputPath, outputPath, Math.min(maxDuration, 25), processRunner);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function run(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
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
        `${program} exited with code ${code}: ${stderr}`,
        'No pude convertir el archivo. Prueba con una foto o un video MP4 más corto.'
      );
      error.details = stderr;
      finish(reject, error);
    });
    // FIX: timer declarado antes de usarlo y kill con SIGKILL
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish(reject, new StickerMediaError(
        'PROCESS_TIMEOUT',
        `${program} exceeded the processing time limit`,
        'La conversión tardó demasiado incluso al recortar el video automáticamente. Prueba con uno de menor resolución.'
      ));
    }, 30_000);
    timer.unref?.();
  });
}

function detectExt(buffer, type) {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return '.jpg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return '.png';
  if (buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  if (buffer.toString('ascii', 4, 8) === 'ftyp') return '.mp4';
  return type === 'video' ? '.mp4' : '.jpg';
}

export async function createStickerMedia(buffer, type, includeAudio = false, processRunner = run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'whatsapp-sticker-'));
  const ext = detectExt(buffer, type);
  const inputPath = path.join(directory, `input${ext}`);
  const stickerPath = path.join(directory, 'sticker.webp');
  const audioPath = path.join(directory, 'audio.ogg');
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    await writeFile(inputPath, buffer);
    let hasAudio = false;
    let inputDuration = null;
    if (type === 'video') {
      const durationProbe = await processRunner(process.env.FFPROBE_PATH || 'ffprobe', includeAudio
        ? ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', inputPath]
        : [
            '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', inputPath
          ]);
      if (includeAudio) {
        let metadata;
        try {
          metadata = JSON.parse(durationProbe.stdout);
        } catch {
          throw new StickerMediaError('INVALID_VIDEO', 'Video metadata is invalid', 'No pude leer la duración del video.');
        }
        const measuredDuration = Number(metadata.format?.duration);
        if (Number.isFinite(measuredDuration) && measuredDuration > 0) inputDuration = measuredDuration;
        hasAudio = metadata.streams?.some(stream => stream.codec_type === 'audio') || false;
      } else {
        const measuredDuration = Number(durationProbe.stdout.trim());
        if (Number.isFinite(measuredDuration) && measuredDuration > 0) inputDuration = measuredDuration;
      }
    }

    const scale = 'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0,format=yuva420p';
    const stickerLimit = type === 'video' ? MAX_ANIMATED_STICKER_BYTES : MAX_STATIC_STICKER_BYTES;
    const qualities = type === 'video' ? ['40', '25', '15'] : ['55', '40', '25'];
    let stickerSize = Infinity;
    let videoDuration = null;
    const durationFallbacks = includeAudio
      ? AUDIO_STICKER_VIDEO_DURATION_FALLBACKS
      : VIDEO_DURATION_FALLBACKS;
    const durations = type === 'video'
      ? [...new Set(durationFallbacks.map(duration => inputDuration ? Math.min(duration, inputDuration) : duration))]
      : [null];
    for (let durationIndex = 0; durationIndex < durations.length; durationIndex++) {
      const duration = durations[durationIndex];
      videoDuration = duration;
      let retryShorter = false;
      for (const quality of qualities) {
        const videoFilter = type === 'video'
          ? `fps=8,trim=end_frame=${duration * 8},setpts=PTS-STARTPTS,${scale}`
          : scale;
        const args = [
          '-hide_banner', '-loglevel', 'error', '-y',
          ...(duration ? ['-t', String(duration)] : []),
          '-i', inputPath,
          ...(duration ? ['-t', String(duration)] : []),
          ...(type === 'video' ? [] : ['-frames:v', '1']),
          '-vf', videoFilter, '-an',
          '-c:v', type === 'video' ? 'libwebp_anim' : 'libwebp',
          '-pix_fmt', 'yuva420p',
          '-quality', quality,
          '-compression_level', type === 'video' ? '2' : '4',
          ...(type === 'video' ? ['-loop', '0', '-lossless', '0'] : ['-lossless', '0']),
          '-f', 'webp', stickerPath
        ];
        try {
          await processRunner(ffmpeg, args);
        } catch (error) {
          if (type === 'video' && error.code === 'PROCESS_TIMEOUT' && durationIndex < durations.length - 1) {
            retryShorter = true;
            break;
          }
          throw error;
        }
        stickerSize = (await stat(stickerPath)).size;
        if (stickerSize <= stickerLimit) break;
        if (type === 'video' && quality === qualities[0] && duration > 1) {
          const estimatedDuration = Math.max(
            1,
            Math.min(duration - 1, Math.floor(duration * stickerLimit / stickerSize * 0.9))
          );
          if (!durations.slice(durationIndex + 1).includes(estimatedDuration)) {
            durations.splice(durationIndex + 1, 0, estimatedDuration);
          }
          retryShorter = true;
          break;
        }
      }
      if (stickerSize <= stickerLimit) break;
      if (retryShorter) continue;
    }
    if (stickerSize > stickerLimit) {
      throw new StickerMediaError(
        'STICKER_TOO_LARGE',
        'Converted sticker exceeded WhatsApp size limits',
        type === 'video'
          ? 'El sticker seguía siendo muy pesado tras recortar el video. Prueba con uno de menor resolución.'
          : 'El sticker quedó muy pesado. Usa una imagen más simple.'
      );
    }

    let audio = null;
    let audioDuration = null;
    if (hasAudio) {
      const convertedAudio = await encodeOggOpus(inputPath, audioPath, videoDuration, processRunner);
      audio = convertedAudio.audio;
      audioDuration = convertedAudio.duration;
    }
    return { sticker: await readFile(stickerPath), audio, duration: audioDuration || videoDuration };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} 
