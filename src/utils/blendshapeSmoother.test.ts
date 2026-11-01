import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OneEuroFilter } from './OneEuroFilter';
import { BlendshapeSmoother } from './blendshapeSmoother';

describe('OneEuroFilter smoothing', () => {
  it('passes a constant signal through near the input', () => {
    const filter = new OneEuroFilter(1, 0.5);
    let value = 0;
    for (let i = 0; i < 30; i += 1) {
      value = filter.filter(0.5, i / 60);
    }
    assert.ok(value > 0.35);
    assert.ok(value < 0.65);
  });

  it('reduces a one-frame spike versus the raw sample', () => {
    const filter = new OneEuroFilter(1, 0);
    filter.filter(0, 0);
    filter.filter(0, 1 / 60);
    const spiked = filter.filter(1, 2 / 60);
    assert.ok(spiked < 1);
    assert.ok(spiked > 0);
  });
});

describe('BlendshapeSmoother', () => {
  it('filters ARKit coefficients independently and clamps the result', () => {
    const smoother = new BlendshapeSmoother({ minCutoff: 1, beta: 0.5, eyeMinCutoff: 2 });
    smoother.filter({ jawOpen: 0 }, 0);
    const first = smoother.filter({ jawOpen: 1, eyeBlinkLeft: 1 }, 1 / 60);
    const later = smoother.filter({ jawOpen: 1, eyeBlinkLeft: 1 }, 20 / 60);
    assert.ok((first.jawOpen ?? 0) < 1);
    assert.ok((later.jawOpen ?? 0) > (first.jawOpen ?? 0));
    assert.ok((later.eyeBlinkLeft ?? 0) > 0);
  });
});
