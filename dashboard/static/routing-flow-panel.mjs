/**
 * routing-flow-panel — Litegraph-based provider/model → tier routing editor (008 — End-User
 * Configurability, US1/FR-014). MeridianOS uses only Litegraph's graph/canvas/node primitives,
 * never its execution engine — routing decisions stay in `model-router.mjs`; dragging a
 * connection here writes through the existing `POST /api/policy` path (FR-002), it never runs
 * graph nodes as code.
 *
 * Write-format limitation (honest, not silently worked around): `setPolicyValue`/`LEVER_PATHS`
 * only ever write a scalar leaf, never the `{provider, model}` object form `model-router.mjs`
 * also accepts (see its `resolveRoutingEntry` doc comment). So a connection here writes the
 * model's bare id as a string — the "legacy string form," which `resolveRoutingEntry` always
 * resolves against provider 'anthropic', regardless of which provider the model actually came
 * from. Provider-qualified routing from this panel would need the write path extended to accept
 * object values, which is out of scope here (no parallel write path per FR-002) — this panel is
 * honest about that in its UI copy rather than silently mis-wiring cross-provider connections.
 */
import { registerPanel } from './settings-workspace.mjs';

let typesRegistered = false;

function ensureNodeTypesRegistered() {
  if (typesRegistered) return;
  typesRegistered = true;

  function ModelNode() {
    this.addOutput('', 'model');
    this.size = [170, 30];
  }
  ModelNode.title = 'Model';
  // eslint-disable-next-line no-undef -- LiteGraph is a vendored global script
  LiteGraph.registerNodeType('routing/model', ModelNode);

  function TierNode() {
    this.addInput('', 'model');
    this.size = [170, 30];
  }
  TierNode.title = 'Tier';
  // eslint-disable-next-line no-undef
  LiteGraph.registerNodeType('routing/tier', TierNode);
}

async function fetchJson(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

async function renderRoutingGraph(el) {
  el.innerHTML = '<div class="workspace-panel-loading">Loading…</div>';

  let routingData, modelsData;
  try {
    [routingData, modelsData] = await Promise.all([
      fetchJson('/api/config/routing'),
      fetchJson('/api/models'),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="workspace-panel-error">Routing editor unavailable: ${String(err.message ?? err)}</div>`;
    return;
  }

  const { agents, tiers, routing } = routingData;
  const models = modelsData.models ?? [];

  if (models.length === 0) {
    el.innerHTML = '<div class="workspace-panel-empty">No models discovered yet — run "Refresh Models" below, then reopen this panel.</div>';
    return;
  }
  if (agents.length === 0) {
    el.innerHTML = '<div class="workspace-panel-empty">No agents configured in this tenant.</div>';
    return;
  }

  ensureNodeTypesRegistered();

  el.innerHTML = `
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">
      Drag a connection from a model to a tier. Writes the bare model id (legacy form — always
      resolves against provider 'anthropic'; see this file's header comment for why).
    </div>
    <div class="workspace-panel-status" id="ws-routing-status"></div>
  `;
  const canvas = document.createElement('canvas');
  canvas.width = el.clientWidth || 380;
  canvas.height = 260;
  canvas.className = 'workspace-litegraph-canvas';
  el.appendChild(canvas);
  const status = el.querySelector('#ws-routing-status');

  // eslint-disable-next-line no-undef
  const graph = new LGraph();
  // eslint-disable-next-line no-undef
  new LGraphCanvas(canvas, graph);

  const modelNodes = new Map(); // model_id -> node
  models.forEach((m, i) => {
    const node = LiteGraph.createNode('routing/model');
    node.title = `${m.provider}:${m.model_id}`;
    node.pos = [20, 20 + i * 45];
    node._modelId = m.model_id;
    graph.add(node);
    modelNodes.set(m.model_id, node);
  });

  const tierNodes = []; // { agent, tier, node }
  let ti = 0;
  for (const agent of agents) {
    for (const tier of tiers) {
      const node = LiteGraph.createNode('routing/tier');
      node.title = `${agent} · ${tier}`;
      node.pos = [280, 20 + ti * 45];
      graph.add(node);
      tierNodes.push({ agent, tier, node });
      ti++;

      // Pre-connect the CURRENT assignment, if it's the simple legacy-string form this panel
      // itself can write (an object-form entry has no single model_id to draw a link from).
      const current = routing?.[agent]?.[tier];
      if (typeof current === 'string' && modelNodes.has(current)) {
        modelNodes.get(current).connect(0, node, 0);
      }
    }
  }

  graph.onConnectionChange = async (targetNode) => {
    const entry = tierNodes.find((t) => t.node === targetNode);
    if (!entry) return; // a model node's own output changed — nothing to write from that side
    const link = targetNode.inputs?.[0]?.link;
    if (link == null) return; // disconnected — this panel doesn't clear the lever on disconnect
    const linkInfo = graph.links[link];
    const sourceNode = graph.getNodeById(linkInfo.origin_id);
    const modelId = sourceNode?._modelId;
    if (!modelId) return;

    status.textContent = 'Saving…';
    try {
      await fetchJson('/api/policy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [`model_routing.${entry.agent}.${entry.tier}`]: modelId }),
      });
      status.textContent = `Saved: ${entry.agent}.${entry.tier} → ${modelId}`;
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch (err) {
      status.textContent = `Save failed: ${String(err.message ?? err)}`;
    }
  };

  graph.start();
}

export function registerRoutingFlowPanel() {
  registerPanel('routing-flow', 'Routing', renderRoutingGraph);
}
