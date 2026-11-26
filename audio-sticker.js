import { prepareWAMessageMedia } from '@rexxhayanasi/elaina-baileys';
import { randomBytes } from 'node:crypto';

export async function sendAudioSticker(sock, chatId, sticker, isAnimated, audio, seconds) {
  if (typeof sock?.waUploadToServer !== 'function' || typeof sock?.relayMessage !== 'function') {
    throw new Error('Baileys socket does not support audio sticker uploads');
  }
  const uploadOptions = { upload: sock.waUploadToServer, logger: sock.logger };
  const preparedSticker = await prepareWAMessageMedia(
    { sticker, isAnimated },
    uploadOptions
  );
  const preparedAudio = await prepareWAMessageMedia(
    { audio, mimetype: 'audio/ogg; codecs=opus', ptt: true },
    uploadOptions
  );

  preparedSticker.stickerMessage.isAnimated = Boolean(isAnimated);
  preparedSticker.stickerMessage.audioMessage = {
    ...preparedAudio.audioMessage,
    seconds: Math.max(1, Math.min(25, Math.ceil(seconds))),
    ptt: true
  };

  const payload = Object.assign(Object.create(preparedSticker), {
    audioStickerMessage: { message: preparedSticker },
    messageContextInfo: { messageSecret: randomBytes(32) }
  });
  return sock.relayMessage(chatId, payload, {});
}
