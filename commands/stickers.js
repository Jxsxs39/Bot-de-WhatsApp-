import {
  createStickerMedia,
  downloadStickerMedia,
  getStickerMediaSource,
  StickerMediaError
} from '../sticker-media.js';

async function createSticker(ctx, includeAudio) {
  const source = getStickerMediaSource(ctx.rawMessage);
  if (!source) {
    return ctx.reply(includeAudio
      ? 'Responde a un video con .s1 o envía un video con .s1 en el caption.'
      : 'Responde a una foto o video con .s2 o envíalo con .s2 en el caption.');
  }
  if (includeAudio && source.type !== 'video') {
    return ctx.reply('.s1 necesita un video. Para fotos o videos sin audio usa .s2.');
  }

  try {
    const buffer = await downloadStickerMedia(source, ctx.sock);
    const result = await createStickerMedia(buffer, source.type, includeAudio);
    await ctx.replyWithSticker(result.sticker, source.type === 'video');
    if (includeAudio) {
      if (result.audio) await ctx.replyWithAudio(result.audio);
      else await ctx.reply('El video no tenía audio; envié el sticker animado sin sonido.');
    }
  } catch (error) {
    if (!(error instanceof StickerMediaError)) throw error;
    console.error('[STICKER]', error.code);
    await ctx.reply(error.userMessage);
  }
}

export default [
  { name: 's1', async run(ctx) { await createSticker(ctx, true); } },
  { name: 's2', async run(ctx) { await createSticker(ctx, false); } }
];
