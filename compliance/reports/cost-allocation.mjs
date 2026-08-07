import { getProjectManager } from '../../control-plane.mjs';

export class CostAllocationReport {
  // Defaults to the shared singleton for real production use; tests inject their own isolated
  // ProjectManager instead of touching the ambient repo-root `.ai/control-plane.db` (a file shared
  // by every other test file that also hits control-plane.mjs — see tests/helpers/wipe-control-plane.mjs).
  constructor(projectManager = getProjectManager()) {
    this.projectManager = projectManager;
  }

  /**
   * Generate Cost Allocation Report
   * @param {Object} options - Report options (startDate, endDate, department)
   * @returns {Object} Generated report data
   */
  generate({ startDate, endDate, department } = {}) {
    // In a real app we'd fetch actual spend from the ledger DB
    const projects = this.projectManager.listProjects();
    
    // Mock cost generation for now
    const allocations = projects.map(p => {
      return {
        projectId: p.id,
        projectName: p.name,
        department: department || 'Engineering',
        computeCost: Math.random() * 100,
        modelCost: Math.random() * 500,
        totalCost: 0
      };
    });

    let totalSpend = 0;
    allocations.forEach(a => {
      a.totalCost = a.computeCost + a.modelCost;
      totalSpend += a.totalCost;
    });

    return {
      reportType: 'Cost_Allocation',
      period: { startDate, endDate },
      department: department || 'All',
      generatedAt: new Date().toISOString(),
      summary: {
        totalProjects: allocations.length,
        totalSpend: Number(totalSpend.toFixed(2))
      },
      allocations
    };
  }

  /**
   * Export Cost Allocation Report to CSV
   * @param {Object} data - Report data from generate()
   * @returns {string} CSV content
   */
  exportCSV(data) {
    let csv = 'Project ID,Project Name,Department,Compute Cost ($),Model Cost ($),Total Cost ($)\n';
    
    data.allocations.forEach(alloc => {
      csv += `${alloc.projectId},${alloc.projectName},${alloc.department},${alloc.computeCost.toFixed(2)},${alloc.modelCost.toFixed(2)},${alloc.totalCost.toFixed(2)}\n`;
    });

    return csv;
  }
}
