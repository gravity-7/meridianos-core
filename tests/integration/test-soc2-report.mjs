import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SOC2Report } from '../../compliance/reports/soc2.mjs';

describe('SOC2 Report Generation', () => {
  it('T161 should generate SOC2 report with valid structure', () => {
    const report = new SOC2Report().generate();
    assert.equal(report.reportType, 'SOC2_Type_2_Draft');
    assert.ok(report.generatedAt);
    assert.ok(report.summary);
    assert.ok(Array.isArray(report.authLogs));
    assert.ok(Array.isArray(report.accessLogs));
    assert.ok(Array.isArray(report.changeLogs));
  });

  it('T161 should export CSV', () => {
    const report = new SOC2Report().generate();
    const csv = new SOC2Report().exportCSV(report);
    assert.ok(csv.includes('Type,Timestamp,User,Action,Details'));
  });
});
