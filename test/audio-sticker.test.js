import test from 'node:test';
import assert from 'node:assert/strict';
import { proto } from '@rexxhayanasi/elaina-baileys';

function readVarint(buffer, cursor) {
  let value = 0;
  let shift = 0;
  while (cursor.offset < buffer.length) {
    const byte = buffer[cursor.offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value >>> 0;
    shift += 7;
  }
  throw new Error('Invalid protobuf varint');
}

function readFields(buffer) {
  const fields = [];
  const cursor = { offset: 0 };
  while (cursor.offset < buffer.length) {
    const tag = readVarint(buffer, cursor);
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 2) {
      const length = readVarint(buffer, cursor);
      fields.push({ field, value: buffer.subarray(cursor.offset, cursor.offset + length) });
      cursor.offset += length;
    } else if (wireType === 0) {
      fields.push({ field, value: readVarint(buffer, cursor) });
    } else {
      throw new Error(`Unexpected protobuf wire type ${wireType}`);
    }
  }
  return fields;
}

test('native audio sticker protobuf encodes sound inside the animated sticker envelope', () => {
  const prepared = proto.Message.fromObject({
    stickerMessage: { mimetype: 'image/webp', isAnimated: true }
  });
  prepared.stickerMessage.audioMessage = proto.Message.AudioMessage.fromObject({
    mimetype: 'audio/ogg; codecs=opus',
    seconds: 3,
    ptt: true
  });
  const payload = Object.assign(Object.create(prepared), {
    audioStickerMessage: { message: prepared }
  });

  const encoded = proto.Message.encode(payload).finish();
  const outerEnvelope = readFields(encoded).find(field => field.field === 134)?.value;
  assert.ok(outerEnvelope, 'outer audio-sticker message field should be present');
  const wrappedMessage = readFields(outerEnvelope).find(field => field.field === 1)?.value;
  assert.ok(wrappedMessage, 'audio sticker should wrap a normal message');
  const sticker = readFields(wrappedMessage).find(field => field.field === 26)?.value;
  assert.ok(sticker, 'wrapped message should contain a sticker');
  assert.ok(readFields(sticker).some(field => field.field === 26), 'sticker should contain its audio message');
  assert.equal(Object.hasOwn(payload, 'audioStickerMessage'), true);
  assert.equal(Object.hasOwn(prepared.stickerMessage, 'audioMessage'), true);
});
