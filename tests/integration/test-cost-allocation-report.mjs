import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CostAllocationReport } from '../../compliance/reports/cost-allocation.mjs';
import { ProjectManager } from '../../control-plane.mjs';

// CostAllocationReport defaults to the shared singleton ProjectManager, which reads/writes the
// ambient repo-root `.ai/control-plane.db` — a file every other test file touching control-plane.mjs
// also shares (see tests/helpers/wipe-control-plane.mjs). Running the full suite, another test's
// concurrent close/delete of that shared file out from under this test's open handle produced an
// intermittent SQLITE_IOERR_FSTAT. An injected, isolated ProjectManager over its own temp-dir db
// removes the shared state entirely instead of trying to coordinate around it.
describe('Cost Allocation Report Generation', () => {
  let tmpDir;
  let projectManager;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aios-cost-allocation-'));
    projectManager = new ProjectManager(join(tmpDir, 'control-plane.db'));
  });

  after(() => {
    projectManager.close();
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  });

  it('T163 should generate Cost Allocation report with valid structure', () => {
    const report = new CostAllocationReport(projectManager).generate();
    assert.equal(report.reportType, 'Cost_Allocation');
    assert.ok(report.summary.totalSpend !== undefined);
    assert.ok(Array.isArray(report.allocations));
  });

  it('T163 should export CSV', () => {
    const report = new CostAllocationReport(projectManager).generate();
    const csv = new CostAllocationReport(projectManager).exportCSV(report);
    assert.ok(csv.includes('Project ID,Project Name,Department,Compute Cost ($),Model Cost ($),Total Cost ($)'));
  });
});
