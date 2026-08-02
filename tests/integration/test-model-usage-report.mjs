import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ModelUsageReport } from '../../compliance/reports/model-usage.mjs';

describe('Model Usage Report Generation', () => {
  it('T164 should generate Model Usage report with valid structure', () => {
    const report = new ModelUsageReport().generate();
    assert.equal(report.reportType, 'Model_Usage_Analytics');
    assert.ok(report.summary.activeModels > 0);
    assert.ok(Array.isArray(report.models));
  });

  it('T164 should export CSV', () => {
    const report = new ModelUsageReport().generate();
    const csv = new ModelUsageReport().exportCSV(report);
    assert.ok(csv.includes('Model,Provider,Invocations,Success Rate,Cost/1k Tokens ($),Total Cost ($)'));
  });
});
