import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ARKIT_BLENDSHAPE_NAMES,
  average,
  clamp01,
  deriveVrmPresets,
  emptyArkitCoefficients,
  isArkitBlendshapeName,
} from './arkitBlendshapes';

describe('ARKit blendshape table', () => {
  it('exposes exactly the 52 ARKit FaceTracking shapes', () => {
    assert.equal(ARKIT_BLENDSHAPE_NAMES.length, 52);
    assert.equal(new Set(ARKIT_BLENDSHAPE_NAMES).size, 52);
    assert.ok(ARKIT_BLENDSHAPE_NAMES.includes('jawOpen'));
    assert.ok(ARKIT_BLENDSHAPE_NAMES.includes('eyeBlinkLeft'));
    assert.ok(ARKIT_BLENDSHAPE_NAMES.includes('tongueOut'));
  });

  it('identifies ARKit names and rejects unknown labels', () => {
    assert.equal(isArkitBlendshapeName('mouthSmileLeft'), true);
    assert.equal(isArkitBlendshapeName('Happy'), false);
  });

  it('clamps and averages coefficient values', () => {
    assert.equal(clamp01(1.4), 1);
    assert.equal(clamp01(-0.2), 0);
    assert.equal(clamp01(Number.NaN), 0);
    assert.equal(average([0, 1]), 0.5);
    assert.equal(average([]), 0);
  });

  it('derives VRM presets from VRCFaceTracking-style ARKit weights', () => {
    const coeffs = emptyArkitCoefficients();
    coeffs.eyeBlinkLeft = 0.8;
    coeffs.eyeBlinkRight = 0.2;
    coeffs.jawOpen = 0.7;
    coeffs.mouthSmileLeft = 0.9;
    coeffs.mouthSmileRight = 0.5;
    coeffs.browInnerUp = 0.6;

    const presets = deriveVrmPresets(coeffs);
    assert.equal(presets.blinkLeft, 0.8);
    assert.equal(presets.blinkRight, 0.2);
    assert.equal(presets.blink, 0.8);
    assert.equal(presets.aa, 0.7);
    assert.equal(presets.happy, 0.7);
    assert.ok(presets.surprised > 0.4);
  });
});
