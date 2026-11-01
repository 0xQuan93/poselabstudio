import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertLanWebSocketUrl, isLanHostname, isLanWebSocketUrl, isPrivateRemoteAddress } from './lanWebSocket';
import { parseArkitFaceMessage } from './arkitFaceProtocol';

describe('LAN-only WebSocket guard', () => {
  it('allows loopback, RFC1918, link-local, and .local hosts', () => {
    assert.equal(isLanWebSocketUrl('ws://127.0.0.1:49122'), true);
    assert.equal(isLanWebSocketUrl('ws://localhost:49122'), true);
    assert.equal(isLanWebSocketUrl('ws://192.168.1.12:49122'), true);
    assert.equal(isLanWebSocketUrl('ws://10.0.0.8:49122'), true);
    assert.equal(isLanWebSocketUrl('ws://172.16.4.2:49122'), true);
    assert.equal(isLanWebSocketUrl('ws://iphone.local:49122'), true);
    assert.equal(isLanHostname('::1'), true);
  });

  it('rejects public internet hosts and non-ws protocols', () => {
    assert.equal(isLanWebSocketUrl('ws://8.8.8.8:49122'), false);
    assert.equal(isLanWebSocketUrl('wss://example.com/face'), false);
    assert.equal(isLanWebSocketUrl('https://192.168.1.12'), false);
    assert.throws(() => assertLanWebSocketUrl('ws://poselab.studio'), /LAN/);
  });

  it('classifies Node remote addresses including IPv4-mapped IPv6', () => {
    assert.equal(isPrivateRemoteAddress('::ffff:192.168.0.9'), true);
    assert.equal(isPrivateRemoteAddress('::ffff:1.1.1.1'), false);
  });
});

describe('ARKit face protocol', () => {
  it('parses a 52-shape companion frame and ignores unknown keys', () => {
    const message = parseArkitFaceMessage(JSON.stringify({
      type: 'arkit-face-frame',
      v: 1,
      t: 42,
      blendshapes: { jawOpen: 0.4, notAShape: 1, eyeBlinkLeft: 2 },
      head: { x: 0, y: 0.1, z: 0, w: 1 },
    }));
    assert.equal(message?.type, 'arkit-face-frame');
    if (!message || message.type !== 'arkit-face-frame') throw new Error('expected frame');
    assert.equal(message.blendshapes.jawOpen, 0.4);
    assert.equal(message.blendshapes.eyeBlinkLeft, 1);
    assert.equal((message.blendshapes as Record<string, number>).notAShape, undefined);
    assert.equal(message.head.y, 0.1);
  });

  it('rejects frames with the wrong protocol version', () => {
    assert.equal(parseArkitFaceMessage(JSON.stringify({ type: 'arkit-face-frame', v: 99 })), null);
  });
});
