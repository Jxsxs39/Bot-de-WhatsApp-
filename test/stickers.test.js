import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from '../database.js';
import { createCommandHandler } from '../handler.js';
import { createStickerMedia, getStickerMediaSource } from '../sticker-media.js';

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

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffmpegAvailable = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0;
test('photo and video inputs produce WebP stickers and video audio separately', {
  skip: ffmpegAvailable ? false : 'FFmpeg is not installed'
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sticker-test-'));
  const imagePath = path.join(directory, 'photo.png');
  const videoPath = path.join(directory, 'video.mp4');
  try {
    const image = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=gold:s=64x64:d=1',
      '-frames:v', '1', imagePath
    ]);
    assert.equal(image.status, 0, image.stderr?.toString());
    const video = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=8:d=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
