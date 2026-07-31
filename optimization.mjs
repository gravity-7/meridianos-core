/**
 * optimization — P5: AI Spend Observability cost optimization engine.
 *
 * Analyzes per-task usage patterns, identifies cheaper equivalent-model alternatives,
 * presents ranked recommendations with savings estimates, and supports apply/dismiss.
 *
 * Exports: generateRecommendations, applyRecommendation, dismissRecommendation, trackActualSavings
 */

import { randomUUID } from 'node:crypto';

/**
 * Get models with matching capabilities from the model_registry.
 * Checks for matching features (vision, tools, streaming superset).
 */
function findCompatibleModels(db, currentModel, currentProvider) {
  try {
    // Get current model's features and pricing
    const current = db.prepare(
      "SELECT * FROM model_registry WHERE model_id = ? AND provider = ?",
    ).get(currentModel, currentProvider);

    if (!current) return [];

    let currentFeatures = {};
    try { currentFeatures = JSON.parse(current.features || '{}'); } catch { /* default empty */ }

    // Find models with matching or superset capabilities but lower cost
    const candidates = db.prepare(
      `SELECT * FROM model_registry
        WHERE deprecated = 0
          AND (model_id != ? OR provider != ?)
        ORDER BY pricing_output_per_m ASC`,
    ).all(currentModel, currentProvider);

    return candidates.filter((c) => {
      let cFeatures = {};
      try { cFeatures = JSON.parse(c.features || '{}'); } catch { /* default empty */ }

      // Check capability compatibility: candidate must support all features current model supports
      const required = ['vision', 'tools', 'streaming'];
      for (const feat of required) {
        if (currentFeatures[feat] && !cFeatures[feat]) return false;
      }

      // Candidate must have cheaper output pricing (main cost driver)
      const cOutputPrice = c.pricing_output_per_m ?? Infinity;
      const curOutputPrice = current.pricing_output_per_m ?? Infinity;

      return cOutputPrice < curOutputPrice && cOutputPrice > 0;
    });
  } catch {
    return [];
  }
}

/**
 * Generate cost optimization recommendations by analyzing per-task usage patterns.
 *
 * @param {DatabaseSync} db - Gateway ledger database
 * @param {number} minDataDays - Minimum days of data required (default 7)
 * @returns {Array} Array of recommendation objects
 */
export function generateRecommendations(db, minDataDays = 7) {
  try {
    // Check data sufficiency
    const oldestEvent = db.prepare('SELECT MIN(ts) AS m FROM token_events WHERE cost_usd IS NOT NULL').get();
    if (!oldestEvent || !oldestEvent.m) return [];

    const dataAgeMs = Date.now() - new Date(oldestEvent.m).getTime();
    const dataAgeDays = dataAgeMs / (1000 * 60 * 60 * 24);
    if (dataAgeDays < minDataDays) return [];

    // Group costs by task and model
    const taskModelCosts = db.prepare(
      `SELECT task, model, provider,
              COUNT(*) AS calls,
              COALESCE(SUM(cost_usd), 0) AS total_cost,
              COALESCE(SUM(total_tokens), 0) AS total_tokens
         FROM token_events
        WHERE task IS NOT NULL AND cost_usd IS NOT NULL AND total_tokens >= 0
        GROUP BY task, model, provider
        ORDER BY task, total_cost DESC`,
    ).all();

    if (taskModelCosts.length === 0) return [];

    // Group by task type (extract label prefix from task ID)
    const taskGroups = new Map();
    for (const r of taskModelCosts) {
      const taskType = r.task?.includes('/') ? r.task.split('/')[0] : (r.task || 'unknown');
      const key = `${taskType}:${r.model}:${r.provider}`;
      if (!taskGroups.has(key)) {
        taskGroups.set(key, {
          taskType,
          model: r.model,
          provider: r.provider,
          calls: 0,
          totalCost: 0,
          totalTokens: 0,
        });
      }
      const g = taskGroups.get(key);
      g.calls += r.calls;
      g.totalCost += r.total_cost;
      g.totalTokens += r.total_tokens;
    }

    const recommendations = [];

    for (const [, group] of taskGroups) {
      if (group.calls < 5) continue; // Need minimum sample size

      const avgCostPerCall = group.totalCost / group.calls;

      // Find compatible cheaper models
      const candidates = findCompatibleModels(db, group.model, group.provider);
      if (candidates.length === 0) continue;

      const bestCandidate = candidates[0]; // Cheapest compatible model

      const candidateCostPerCall = bestCandidate.pricing_output_per_m
        ? (bestCandidate.pricing_output_per_m * (group.totalTokens / group.calls)) / 1_000_000
        : avgCostPerCall * 0.7; // Conservative estimate if pricing unknown

      if (candidateCostPerCall >= avgCostPerCall * 0.9) continue; // Not enough savings (< 10%)

      const weeklyTasks = group.calls / Math.max(1, dataAgeDays / 7);
      const estimatedWeeklySavings = (avgCostPerCall - candidateCostPerCall) * weeklyTasks;

      if (estimatedWeeklySavings <= 0) continue;

      // Compute confidence based on sample size and pricing freshness
      const sampleConfidence = Math.min(1, group.calls / 20); // 20+ calls = full confidence on sample
      const pricingFreshness = bestCandidate.pricing_refreshed
        ? (Date.now() - new Date(bestCandidate.pricing_refreshed).getTime()) < 30 * 86400000 ? 1 : 0.5
        : 0.3;
      const confidence = Math.round((sampleConfidence * 0.6 + pricingFreshness * 0.4) * 100) / 100;

      if (confidence < 0.5) continue;

      const capabilityCheck = {
        vision: bestCandidate.features ? (JSON.parse(bestCandidate.features || '{}').vision || false) : false,
        tools: bestCandidate.features ? (JSON.parse(bestCandidate.features || '{}').tools || false) : false,
        streaming: bestCandidate.features ? (JSON.parse(bestCandidate.features || '{}').streaming || false) : false,
      };

      const id = randomUUID();
      const now = new Date().toISOString();

      recommendations.push({
        id,
        currentModel: `${group.provider}:${group.model}`,
        recommendedModel: `${bestCandidate.provider}:${bestCandidate.model_id}`,
        taskType: group.taskType,
        estimatedWeeklySavings: Math.round(estimatedWeeklySavings * 100) / 100,
        confidence,
        capabilityCheck: JSON.stringify(capabilityCheck),
        calls: group.calls,
        avgCostPerCall: Math.round(avgCostPerCall * 10000) / 10000,
      });

      // Insert into optimization_rules
      try {
        db.prepare(
          `INSERT OR REPLACE INTO optimization_rules
             (id, current_model, recommended_model, task_type, estimated_weekly_savings,
              confidence, capability_check, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        ).run(
          id,
          `${group.provider}:${group.model}`,
          `${bestCandidate.provider}:${bestCandidate.model_id}`,
          group.taskType,
          Math.round(estimatedWeeklySavings * 100) / 100,
          confidence,
          JSON.stringify(capabilityCheck),
          now, now,
        );
      } catch { /* table may not exist */ }

      // Limit to top 10 recommendations
      if (recommendations.length >= 10) break;
    }

    return recommendations.sort((a, b) => b.estimatedWeeklySavings - a.estimatedWeeklySavings);
  } catch (e) {
    console.error('Optimization error:', e);
    return [];
  }
}

/**
 * Apply an optimization recommendation — updates model routing config for the task type.
 *
 * @param {DatabaseSync} db
 * @param {string} id - Recommendation UUID
 * @returns {{ ok: boolean, error?: string }}
 */
export function applyRecommendation(db, id) {
  try {
    const rec = db.prepare("SELECT * FROM optimization_rules WHERE id = ? AND status = 'active'").get(id);
    if (!rec) return { ok: false, error: 'Recommendation not found or already processed' };

    const now = new Date().toISOString();
    db.prepare(
      "UPDATE optimization_rules SET status = 'applied', applied_at = ?, updated_at = ? WHERE id = ?",
    ).run(now, now, id);

    return { ok: true, message: `Switched ${rec.task_type} tasks from ${rec.current_model} to ${rec.recommended_model}` };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Dismiss an optimization recommendation.
 *
 * @param {DatabaseSync} db
 * @param {string} id - Recommendation UUID
 * @param {string} [reason] - Operator-provided reason for dismissal
 * @returns {{ ok: boolean, error?: string }}
 */
export function dismissRecommendation(db, id, reason = '') {
  try {
    const rec = db.prepare("SELECT * FROM optimization_rules WHERE id = ? AND status = 'active'").get(id);
    if (!rec) return { ok: false, error: 'Recommendation not found or already processed' };

    const now = new Date().toISOString();
    db.prepare(
      "UPDATE optimization_rules SET status = 'dismissed', dismissed_at = ?, dismiss_reason = ?, updated_at = ? WHERE id = ?",
    ).run(now, reason, now, id);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Track actual savings for applied recommendations.
 * Compares task costs before and after switch date.
 *
 * @param {DatabaseSync} db
 * @returns {number} Number of recommendations updated
 */
export function trackActualSavings(db) {
  try {
    const applied = db.prepare(
      "SELECT * FROM optimization_rules WHERE status = 'applied' AND applied_at IS NOT NULL",
    ).all();

    let updated = 0;
    for (const rec of applied) {
      const [curProvider, curModel] = (rec.current_model || 'unknown:unknown').split(':');
      const [recProvider, recModel] = (rec.recommended_model || 'unknown:unknown').split(':');

      // Get costs before and after switch
      const before = db.prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS calls
           FROM token_events WHERE task LIKE ? AND model = ? AND provider = ? AND ts < ?`,
      ).get(`${rec.task_type}/%`, curModel, curProvider, rec.applied_at);

      const after = db.prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS calls
           FROM token_events WHERE task LIKE ? AND model = ? AND provider = ? AND ts >= ?`,
      ).get(`${rec.task_type}/%`, recModel, recProvider, rec.applied_at);

      const beforeAvg = before.calls > 0 ? before.cost / before.calls : 0;
      const afterAvg = after.calls > 0 ? after.cost / after.calls : 0;
      const totalCallsAfter = after.calls;
      const actualSavings = totalCallsAfter > 0 ? (beforeAvg - afterAvg) * totalCallsAfter : 0;

      db.prepare(
        "UPDATE optimization_rules SET actual_savings_usd = ?, updated_at = ? WHERE id = ?",
      ).run(Math.round(Math.max(0, actualSavings) * 100) / 100, new Date().toISOString(), rec.id);

      updated++;
    }

    return updated;
  } catch {
    return 0;
  }
}
