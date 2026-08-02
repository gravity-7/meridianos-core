import { getAuditLogger, getActivityLogger } from '../audit-log.mjs';
import fs from 'node:fs';

export class SOC2Report {
  constructor() {
    this.auditLogger = getAuditLogger();
    this.activityLogger = getActivityLogger();
  }

  /**
   * Generate SOC2 Report
   * @param {Object} options - Report options (startDate, endDate)
   * @returns {Object} Generated report data
   */
  generate({ startDate, endDate } = {}) {
    const authLogs = this.auditLogger.query({ category: 'auth', startDate, endDate });
    const accessLogs = this.auditLogger.query({ category: 'access', startDate, endDate });
    
    // Some activity logs count as change logs for SOC2
    const allActivity = this.activityLogger.query({ startDate, endDate });
    const changeLogs = allActivity.filter(a => ['config_change', 'project_update', 'user_role_change'].includes(a.action));

    return {
      reportType: 'SOC2_Type_2_Draft',
      period: { startDate, endDate },
      generatedAt: new Date().toISOString(),
      summary: {
        totalAuthEvents: authLogs.length,
        totalAccessEvents: accessLogs.length,
        totalChangeEvents: changeLogs.length
      },
      authLogs,
      accessLogs,
      changeLogs
    };
  }

  /**
   * Export SOC2 Report to CSV
   * @param {Object} data - Report data from generate()
   * @returns {string} CSV content
   */
  exportCSV(data) {
    let csv = 'Type,Timestamp,User,Action,Details\n';
    
    data.authLogs.forEach(log => {
      csv += `Auth,${new Date(log.timestamp * 1000).toISOString()},${log.user_id},${log.action},"${JSON.stringify(log.details).replace(/"/g, '""')}"\n`;
    });
    
    data.accessLogs.forEach(log => {
      csv += `Access,${new Date(log.timestamp * 1000).toISOString()},${log.user_id},${log.action},"${JSON.stringify(log.details).replace(/"/g, '""')}"\n`;
    });
    
    data.changeLogs.forEach(log => {
      csv += `Change,${new Date(log.timestamp * 1000).toISOString()},${log.user_id},${log.action},"${JSON.stringify(log.details).replace(/"/g, '""')}"\n`;
    });

    return csv;
  }

  /**
   * Export SOC2 Report to PDF
   * Note: In a real system this would generate a binary PDF. Here we mock it.
   * @param {Object} data - Report data from generate()
   * @returns {Buffer} Mock PDF buffer
   */
  exportPDF(data) {
    const content = `SOC2 Report\nPeriod: ${data.period.startDate} to ${data.period.endDate}\nGenerated: ${data.generatedAt}\n\nSummary:\nAuth Events: ${data.summary.totalAuthEvents}\nAccess Events: ${data.summary.totalAccessEvents}\nChange Events: ${data.summary.totalChangeEvents}`;
    return Buffer.from(content, 'utf8');
  }
}
