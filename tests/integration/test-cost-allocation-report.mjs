import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CostAllocationReport } from '../../compliance/reports/cost-allocation.mjs';

describe('Cost Allocation Report Generation', () => {
  it('T163 should generate Cost Allocation report with valid structure', () => {
    const report = new CostAllocationReport().generate();
    assert.equal(report.reportType, 'Cost_Allocation');
    assert.ok(report.summary.totalSpend !== undefined);
    assert.ok(Array.isArray(report.allocations));
  });

  it('T163 should export CSV', () => {
    const report = new CostAllocationReport().generate();
    const csv = new CostAllocationReport().exportCSV(report);
    assert.ok(csv.includes('Project ID,Project Name,Department,Compute Cost ($),Model Cost ($),Total Cost ($)'));
  });
});
