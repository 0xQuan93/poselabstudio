import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyNeutralCalibration,
  categoriesToArkitCoefficients,
  kalidokitFaceToArkit,
  mapArkitToVrm,
  normalizeBlendshapeLabel,
} from './blendshapeMapper';

describe('blendshape mapper', () => {
  it('normalizes MediaPipe / ARKit labels', () => {
    assert.equal(normalizeBlendshapeLabel('jawOpen'), 'jawOpen');
    assert.equal(normalizeBlendshapeLabel('EyeBlinkLeft'), 'eyeBlinkLeft');
    assert.equal(normalizeBlendshapeLabel('not-a-shape'), null);
  });

  it('maps Face Landmarker categories onto ARKit coefficients', () => {
    const coeffs = categoriesToArkitCoefficients([
      { categoryName: 'jawOpen', score: 0.4 },
      { categoryName: 'eyeBlinkLeft', score: 1.2 },
      { categoryName: '_ignored', score: 1 },
    ]);
    assert.equal(coeffs.jawOpen, 0.4);
    assert.equal(coeffs.eyeBlinkLeft, 1);
    assert.equal(coeffs.tongueOut, undefined);
  });

  it('maps 1:1 ARKit names when the VRM exposes them', () => {
    const mapped = mapArkitToVrm(
      { jawOpen: 0.5, eyeBlinkLeft: 0.8, mouthSmileLeft: 0.3 },
      ['jawOpen', 'eyeBlinkLeft', 'mouthSmileLeft', 'happy'],
    );
    assert.equal(mapped.targets.jawOpen, 0.5);
    assert.equal(mapped.targets.eyeBlinkLeft, 0.8);
    assert.ok(mapped.directArkitHits > 0);
  });

  it('falls back to VRM 1.0 presets when ARKit shapes are missing', () => {
    const mapped = mapArkitToVrm(
      { jawOpen: 0.9, eyeBlinkLeft: 1, eyeBlinkRight: 1, mouthSmileLeft: 0.8, mouthSmileRight: 0.8 },
      ['aa', 'blink', 'happy', 'Joy'],
    );
    assert.equal(mapped.targets.aa, 0.9);
    assert.equal(mapped.targets.blink, 1);
    assert.equal(mapped.targets.happy, 0.8);
    assert.ok(mapped.presetHits > 0);
  });

  it('subtracts a captured neutral rest pose', () => {
    const calibrated = applyNeutralCalibration(
      { jawOpen: 0.5, eyeBlinkLeft: 0.2 },
      { jawOpen: 0.2, eyeBlinkLeft: 0.2 },
    );
    assert.equal(calibrated.jawOpen, 0.3);
    assert.equal(calibrated.eyeBlinkLeft, 0);
  });

  it('approximates ARKit coefficients from a Kalidokit face rig', () => {
    const coeffs = kalidokitFaceToArkit({
      eye: { l: 0.2, r: 1 },
      pupil: { x: 0.5, y: -0.4 },
      smile: 0.6,
      mouth: { open: 0.3, shape: { A: 0.3, E: 0.1, I: 0.2, O: 0.4, U: 0.5 } },
      brow: 0.7,
    });
    assert.equal(coeffs.eyeBlinkLeft, 0.8);
    assert.equal(coeffs.eyeBlinkRight, 0);
    assert.equal(coeffs.jawOpen, 0.3);
    assert.equal(coeffs.mouthPucker, 0.4);
    assert.equal(coeffs.browInnerUp, 0.7);
    assert.equal(coeffs.eyeLookOutRight, 0.5);
    assert.equal(coeffs.eyeLookUpLeft, 0.4);
  });
});
