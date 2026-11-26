import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { proto } from '@rexxhayanasi/elaina-baileys';
import Database from '../database.js';
import { createCommandHandler } from '../handler.js';
import {
  convertAudioStickerAudio,
  createStickerMedia,
  getAudioMediaSource,
  getStickerMediaSource,
  StickerMediaError
} from '../sticker-media.js';
import { sendAudioSticker } from '../audio-sticker.js';
import { withGenerationNotice } from '../commands/stickers.js';

test('sticker source can be direct media or a quoted photo/video', () => {
  const direct = {
    key: { remoteJid: '123@s.whatsapp.net', id: 'direct' },
    message: { videoMessage: { caption: '.s1' } }
  };
  assert.equal(getStickerMediaSource(direct).type, 'video');

  const quoted = {
    key: { remoteJid: '123@g.us', id: 'command' },
    message: {
      extendedTextMessage: {
        text: '.s2',
        contextInfo: {
          stanzaId: 'quoted',
          participant: '456@s.whatsapp.net',
          quotedMessage: { imageMessage: { mimetype: 'image/jpeg' } }
        }
      }
    }
  };
  const source = getStickerMediaSource(quoted);
  assert.equal(source.type, 'image');
  assert.equal(source.message.key.id, 'quoted');
  const quotedVideo = getStickerMediaSource({
    ...quoted,
    message: {
      extendedTextMessage: {
        text: '.s1',
        contextInfo: {
          stanzaId: 'quoted-video',
          quotedMessage: { videoMessage: { mimetype: 'video/mp4' } }
        }
      }
    }
  });
  assert.equal(quotedVideo.type, 'video');
  assert.equal(quotedVideo.message.key.id, 'quoted-video');
  const quotedAudio = getAudioMediaSource({
    ...quoted,
    message: {
      extendedTextMessage: {
        text: '.s1',
        contextInfo: {
          stanzaId: 'quoted-audio',
          quotedMessage: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } }
        }
      }
    }
  });
  assert.equal(quotedAudio.mimetype, 'audio/ogg; codecs=opus');
  assert.equal(quotedAudio.message.key.id, 'quoted-audio');
  assert.equal(getStickerMediaSource({ message: { conversation: '.s2' } }), null);
});

test('sticker commands explain how to attach media when none is provided', async () => {
  const db = await new Database(':memory:').init();
  try {
    const sent = [];
    const handler = createCommandHandler({
      sendMessage: async (...args) => { sent.push(args); }
    }, db);
    for (const command of ['.s1', '.s2']) {
      await handler.handleMessage({
        key: { remoteJid: '123@s.whatsapp.net' },
        message: { conversation: command }
      });
    }
    assert.equal(sent.length, 2);
    assert.match(sent[0][1].text, /Responde a un video/);
    assert.match(sent[1][1].text, /Responde a una foto o video/);
  } finally {
    await db.close();
  }
});

test('.s1 muestra el progreso y borra el aviso al terminar o fallar', async () => {
  const events = [];
  const ctx = {
    chatId: '123@s.whatsapp.net',
    reply: async text => {
      events.push(['reply', text]);
      return { key: { remoteJid: '123@s.whatsapp.net', id: 'progress' } };
    },
    sock: {
      sendMessage: async (chatId, content) => {
        events.push(['delete', chatId, content.delete.id]);
      }
    }
  };

  await withGenerationNotice(ctx, async () => events.push(['generate']));
  assert.deepEqual(events.map(event => event[0]), ['reply', 'generate', 'delete']);
  assert.match(events[0][1], /se está generando/);

  events.length = 0;
  await assert.rejects(withGenerationNotice(ctx, async () => {
    throw new Error('conversion failed');
  }), /conversion failed/);
  assert.deepEqual(events.map(event => event[0]), ['reply', 'delete']);
});

test('video conversion retries with a shorter clip after timing out', async () => {
  const stickerDurations = [];
  let audioDuration;
  const processRunner = async (_program, args) => {
    if (args.includes('format=duration:format=format_name:stream=codec_name,sample_rate,channels')) {
      return { stdout: JSON.stringify({
        format: { duration: audioDuration, format_name: 'ogg' },
        streams: [{ codec_name: 'opus', sample_rate: '48000', channels: 1 }]
      }), stderr: '' };
    }
    if (args.includes('format=duration:stream=codec_type')) return {
      stdout: JSON.stringify({ format: { duration: '30' }, streams: [{ codec_type: 'audio' }] }),
      stderr: ''
    };
    if (args.includes('null')) return { stdout: '', stderr: '' };
    if (args.includes('-c:v')) {
      const duration = Number(args[args.indexOf('-t') + 1]);
      stickerDurations.push(duration);
      if (duration === 25) throw new StickerMediaError('PROCESS_TIMEOUT', 'timed out');
      await writeFile(args[args.length - 1], Buffer.from('fake-webp'));
      return { stdout: '', stderr: '' };
    }
    if (args.includes('-c:a')) {
      audioDuration = Number(args[args.indexOf('-t') + 1]);
      assert.ok(args.includes('aresample=async=1:first_pts=0,asetpts=N/SR/TB'));
      assert.ok(args.includes('make_zero'));
      await writeFile(args[args.length - 1], Buffer.from('OggS-fake-audio'));
      return { stdout: '', stderr: '' };
    }
    assert.fail(`Unexpected process args: ${args.join(' ')}`);
  };
  const result = await createStickerMedia(Buffer.from('0000ftypisom'), 'video', true, processRunner);

  assert.deepEqual(stickerDurations, [25, 10]);
  assert.equal(audioDuration, 10);
  assert.equal(result.duration, 10);
  assert.equal(result.audio.toString(), 'OggS-fake-audio');
});

test('.s1 estimates a shorter duration instead of retrying every quality', async () => {
  const encoded = [];
  let audioDuration;
  const processRunner = async (_program, args) => {
    if (args.includes('format=duration:format=format_name:stream=codec_name,sample_rate,channels')) {
      return { stdout: JSON.stringify({
        format: { duration: audioDuration, format_name: 'ogg' },
        streams: [{ codec_name: 'opus', sample_rate: '48000', channels: 1 }]
      }), stderr: '' };
    }
    if (args.includes('format=duration:stream=codec_type')) return {
      stdout: JSON.stringify({ format: { duration: '25' }, streams: [{ codec_type: 'audio' }] }),
      stderr: ''
    };
    if (args.includes('null')) return { stdout: '', stderr: '' };
    if (args.includes('-c:v')) {
      const duration = Number(args[args.indexOf('-t') + 1]);
      encoded.push({
        duration,
        quality: args[args.indexOf('-quality') + 1],
        compression: args[args.indexOf('-compression_level') + 1]
      });
      await writeFile(args[args.length - 1], Buffer.alloc(duration === 25 ? 1_000_000 : 450_000));
      return { stdout: '', stderr: '' };
    }
    if (args.includes('-c:a')) {
      audioDuration = Number(args[args.indexOf('-t') + 1]);
      await writeFile(args[args.length - 1], Buffer.from('OggS-fake-audio'));
      return { stdout: '', stderr: '' };
    }
    assert.fail(`Unexpected process args: ${args.join(' ')}`);
  };
  const result = await createStickerMedia(Buffer.from('0000ftypisom'), 'video', true, processRunner);
  assert.deepEqual(encoded.map(({ duration }) => duration), [25, 11]);
  assert.ok(encoded.every(({ quality }) => quality === '40'));
  assert.ok(encoded.every(({ compression }) => compression === '2'));
  assert.equal(result.duration, 11);
  assert.equal(audioDuration, 11);
});

test('audio sticker conversion caps audio at 25 seconds', async () => {
  const result = await convertAudioStickerAudio(
    Buffer.from('audio input'),
    'audio/mpeg',
    async (program, args) => {
      if (args.includes('-show_entries')) return { stdout: JSON.stringify({
        format: { duration: '27.5', format_name: 'ogg' },
        streams: [{ codec_name: 'opus', sample_rate: '48000', channels: 1 }]
      }), stderr: '' };
      if (args.includes('null')) return { stdout: '', stderr: '' };
      if (program.toLowerCase().includes('ffmpeg')) {
        assert.ok(args.includes('-t'));
        assert.ok(args.includes('25'));
        assert.ok(args.includes('aresample=async=1:first_pts=0,asetpts=N/SR/TB'));
        await writeFile(args[args.length - 1], Buffer.from('OggS-audio'));
        return { stdout: '', stderr: '' };
      }
      assert.fail(`Unexpected process args: ${args.join(' ')}`);
    }
  );
  assert.equal(result.audio.toString(), 'OggS-audio');
  assert.equal(result.duration, 25);
});

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffmpegAvailable = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0;
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const ffprobeAvailable = spawnSync(ffprobe, ['-version'], { stdio: 'ignore' }).status === 0;
test('long videos are trimmed to sticker length and produce WebP and audio outputs', {
  skip: ffmpegAvailable && ffprobeAvailable ? false : 'FFmpeg and ffprobe are required'
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sticker-test-'));
  const imagePath = path.join(directory, 'photo.png');
  const videoPath = path.join(directory, 'video.mp4');
  const audioPath = path.join(directory, 'audio.ogg');
  try {
    const image = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=gold:s=64x64:d=1',
      '-frames:v', '1', imagePath
    ]);
    assert.equal(image.status, 0, image.stderr?.toString());
    const video = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=32x32:rate=8:duration=26',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=26',
      '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac', videoPath
    ]);
    assert.equal(video.status, 0, video.stderr?.toString());

    const photoSticker = await createStickerMedia(await readFile(imagePath), 'image');
    const videoSticker = await createStickerMedia(await readFile(videoPath), 'video', true);
    assert.equal(photoSticker.sticker.toString('ascii', 0, 4), 'RIFF');
    assert.equal(photoSticker.sticker.toString('ascii', 8, 12), 'WEBP');
    assert.equal(videoSticker.sticker.toString('ascii', 0, 4), 'RIFF');
    assert.equal(videoSticker.sticker.toString('ascii', 8, 12), 'WEBP');
    assert.equal(videoSticker.audio.toString('ascii', 0, 4), 'OggS');
    assert.ok(videoSticker.duration > 0 && videoSticker.duration <= 25);
    await writeFile(audioPath, videoSticker.audio);
    // FFprobe no decodifica WebP animado en todas las versiones. Lee los chunks ANMF del contenedor.
    let frames = 0;
    let durationMs = 0;
    for (let offset = 12; offset + 8 <= videoSticker.sticker.length;) {
      const size = videoSticker.sticker.readUInt32LE(offset + 4);
      assert.ok(offset + 8 + size <= videoSticker.sticker.length);
      if (videoSticker.sticker.toString('ascii', offset, offset + 4) === 'ANMF') {
        assert.ok(size >= 16);
        frames++;
        durationMs += videoSticker.sticker.readUIntLE(offset + 20, 3);
      }
      offset += 8 + size + (size % 2);
    }
    assert.ok(frames > 0 && frames <= videoSticker.duration * 8, `animated sticker had ${frames} frames for ${videoSticker.duration} seconds`);
    assert.ok(durationMs <= videoSticker.duration * 1000, `animated sticker lasted ${durationMs} ms`);
    const audioDuration = spawnSync(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', audioPath
    ], { encoding: 'utf8' });
    assert.equal(audioDuration.status, 0, audioDuration.stderr);
    assert.ok(Number(audioDuration.stdout.trim()) <= videoSticker.duration + 0.1, 'audio exceeded the sticker duration');

    const sentMediaTypes = [];
    let relayedPayload;
    await sendAudioSticker({
      waUploadToServer: async (_filePath, { mediaType }) => {
        sentMediaTypes.push(mediaType);
        return { mediaUrl: 'https://example.invalid/media', directPath: '/media/audio-sticker' };
      },
      relayMessage: async (chatId, payload) => {
        assert.equal(chatId, '123@s.whatsapp.net');
        relayedPayload = payload;
      }
    }, '123@s.whatsapp.net', videoSticker.sticker, true, videoSticker.audio, videoSticker.duration);
    assert.deepEqual(sentMediaTypes.sort(), ['audio', 'sticker']);
    assert.ok(proto.Message.encode(relayedPayload).finish().length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
