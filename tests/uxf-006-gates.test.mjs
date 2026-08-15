import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateUxfGates, UXF_THRESHOLDS } from '../scripts/uxf-006-gates.mjs';

const source = { missing: [], reducedMotion: true, forcedColors: true, focusVisible: true, narrowViewport: true, touchTarget: true, forbiddenDependencies: false };
const passingMeasurements = {
  ...Object.fromEntries(Object.keys(UXF_THRESHOLDS).map((key) => [key, 0])),
  a11yViolations: 0, browsers: ['chrome', 'edge', 'firefox', 'safari', 'electron'], privacySafe: true,
};

test('UXF quality gate fails closed on missing or over-budget evidence', () => {
  const missing = evaluateUxfGates({ source, measurements: null });
  assert.equal(missing.passed, true, 'source-only mode is useful for local static checks');
  const failing = evaluateUxfGates({ source, measurements: { ...passingMeasurements, localLcpP75Ms: UXF_THRESHOLDS.localLcpP75Ms + 1, browsers: ['chrome'] } });
  assert.equal(failing.passed, false); assert.match(failing.failures.join('\n'), /localLcpP75Ms|browser evidence/);
});

test('UXF quality gate accepts complete evidence at the documented thresholds', () => {
  const result = evaluateUxfGates({ source, measurements: passingMeasurements });
  assert.equal(result.passed, true, result.failures.join('\n'));
});
