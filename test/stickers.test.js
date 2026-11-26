import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from '../database.js';
import { createCommandHandler } from '../handler.js';
import { createStickerMedia, getStickerMediaSource, StickerMediaError } from '../sticker-media.js';

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

test('video conversion retries with a shorter clip after timing out', async () => {
  const stickerDurations = [];
  let audioDuration;
  const processRunner = async (_program, args) => {
    if (args.includes('-show_entries')) return { stdout: 'audio', stderr: '' };
    if (args.includes('-c:v')) {
      const duration = Number(args[args.indexOf('-t') + 1]);
      stickerDurations.push(duration);
      if (duration === 5) throw new StickerMediaError('PROCESS_TIMEOUT', 'timed out');
      await writeFile(args[args.length - 1], Buffer.from('fake-webp'));
      return { stdout: '', stderr: '' };
    }
    if (args.includes('-c:a')) {
      audioDuration = Number(args[args.indexOf('-t') + 1]);
      await writeFile(args[args.length - 1], Buffer.from('fake-audio'));
      return { stdout: '', stderr: '' };
    }
    assert.fail(`Unexpected process args: ${args.join(' ')}`);
  };
  const result = await createStickerMedia(Buffer.from('0000ftypisom'), 'video', true, processRunner);

  assert.deepEqual(stickerDurations, [5, 3]);
  assert.equal(audioDuration, 3);
  assert.equal(result.duration, 3);
  assert.equal(result.audio.toString(), 'fake-audio');
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
  const stickerPath = path.join(directory, 'sticker.webp');
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
      '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=8:duration=8',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
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
    assert.equal(videoSticker.duration, 5);
    await writeFile(stickerPath, videoSticker.sticker);
    await writeFile(audioPath, videoSticker.audio);
    const stickerFrames = spawnSync(ffprobe, [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames', '-of', 'default=noprint_wrappers=1:nokey=1', stickerPath
    ], { encoding: 'utf8' });
    assert.equal(stickerFrames.status, 0, stickerFrames.stderr);
    assert.ok(
      Number(stickerFrames.stdout.trim()) <= 40,
      `animated sticker had ${stickerFrames.stdout.trim()} frames; expected at most 40`
    );
    const audioDuration = spawnSync(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', audioPath
    ], { encoding: 'utf8' });
    assert.equal(audioDuration.status, 0, audioDuration.stderr);
    assert.ok(Number(audioDuration.stdout.trim()) <= 5.1, 'audio exceeded the 5-second limit');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
