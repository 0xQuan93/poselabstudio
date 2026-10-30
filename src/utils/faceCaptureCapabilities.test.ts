import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectClientPlatform, describeCaptureTier } from './faceCaptureCapabilities';

describe('face capture capability copy', () => {
  it('detects iPhone Safari versus Chrome Android', () => {
    const iphoneSafari = detectClientPlatform(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    );
    assert.equal(iphoneSafari.isIOS, true);
    assert.equal(iphoneSafari.isSafari, true);

    const androidChrome = detectClientPlatform(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    );
    assert.equal(androidChrome.isAndroid, true);
    assert.equal(androidChrome.isSafari, false);
  });

  it('describes the iPhone Safari Face Landmarker path honestly', () => {
    const copy = describeCaptureTier('mediapipe-face');
    assert.match(copy.detail.toLowerCase(), /iphone safari/);
    assert.doesNotMatch(copy.detail.toLowerCase(), /truedepth/);
    assert.match(describeCaptureTier('webxr-ar').detail.toLowerCase(), /not available in ios safari/);
  });
});
