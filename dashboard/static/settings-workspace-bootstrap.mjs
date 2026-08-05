/**
 * settings-workspace-bootstrap — wires the panel-grid shell to its panel modules and initializes
 * it into #settingsWorkspaceContainer. Loaded lazily (dashboard/index.html's showSettingsWorkspace)
 * the first time the operator opens the workspace, so the vendored libraries' parse/init cost is
 * never paid on a normal dashboard load that never opens Settings.
 */
import { initWorkspace } from './settings-workspace.mjs';
import { registerSettingsPanels } from './settings-panels.mjs';
import { registerObservabilityPanels } from './observability-panels.mjs';
import { registerRoutingFlowPanel } from './routing-flow-panel.mjs';

registerSettingsPanels();
registerObservabilityPanels();
registerRoutingFlowPanel();
initWorkspace(document.getElementById('settingsWorkspaceContainer'));
