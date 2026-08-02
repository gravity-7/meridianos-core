import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GDPRReport } from '../../compliance/reports/gdpr.mjs';

describe('GDPR Report Generation', () => {
  it('T162 should generate GDPR report with valid structure', () => {
    const report = new GDPRReport().generate();
    assert.equal(report.reportType, 'GDPR_Data_Processing');
    assert.ok(report.generatedAt);
    assert.ok(Array.isArray(report.dataFlows));
    assert.ok(report.dataFlows.length > 0);
  });

  it('T162 should export CSV', () => {
    const report = new GDPRReport().generate();
    const csv = new GDPRReport().exportCSV(report);
    assert.ok(csv.includes('Provider,Region,DataCategory,Retention'));
  });
});
