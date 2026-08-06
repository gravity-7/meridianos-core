/**
 * API Key Management UI
 * Generate, list, and revoke API tokens
 */

// Guards the document-level revoke-button click delegate below so re-mounting this panel (e.g.
// switching Admin sub-tabs away and back) never binds a second delegate and double-fires revokes.
let _revokeListenerWired = false;

export function renderApiKeysPanel(tokens = []) {
  return `
    <div class="api-keys-panel">
      <div class="panel-header">
        <h2>API Keys</h2>
        <button id="create-token-btn" class="btn btn-primary">
          <span class="icon">+</span> Generate API Key
        </button>
      </div>

      <div class="api-keys-list">
        ${tokens.length === 0 ? renderEmptyState() : tokens.map(renderTokenRow).join('')}
      </div>

      <div id="create-token-modal" class="modal hidden">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Generate API Key</h3>
            <button class="modal-close">&times;</button>
          </div>
          <form id="create-token-form">
            <div class="form-group">
              <label for="token-name">Token Name</label>
              <input type="text" id="token-name" name="name" required
                     placeholder="e.g., Production API Key"
                     maxlength="100">
              <small>1-100 characters</small>
            </div>

            <div class="form-group">
              <label for="token-scope">Scope</label>
              <select id="token-scope" name="scope" required>
                <option value="viewer">Viewer - Read-only access</option>
                <option value="operator">Operator - Read and modify tasks</option>
                <option value="admin">Admin - Full access</option>
              </select>
            </div>

            <div class="form-group">
              <label for="token-expires">Expiration</label>
              <select id="token-expires" name="expiresIn">
                <option value="">Never expires</option>
                <option value="86400">24 hours</option>
                <option value="604800">7 days</option>
                <option value="2592000">30 days</option>
                <option value="7776000">90 days</option>
              </select>
            </div>

            <div class="form-actions">
              <button type="button" class="btn btn-secondary modal-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Generate Key</button>
            </div>
          </form>
        </div>
      </div>

      <div id="token-created-modal" class="modal hidden">
        <div class="modal-content">
          <div class="modal-header">
            <h3>API Key Generated</h3>
            <button class="modal-close">&times;</button>
          </div>
          <div class="token-created-content">
            <p class="warning">⚠️ Copy this key now. You won't be able to see it again.</p>
            <div class="token-display">
              <code id="generated-token"></code>
              <button id="copy-token-btn" class="btn btn-sm btn-secondary">Copy</button>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-primary modal-close">Done</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderEmptyState() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">🔑</div>
      <h3>No API Keys Yet</h3>
      <p>Generate an API key to access MeridianOS programmatically.</p>
      <button id="create-first-token-btn" class="btn btn-primary">
        Generate Your First API Key
      </button>
    </div>
  `;
}

function renderTokenRow(token) {
  const statusClass = token.is_active ? 'active' : 'revoked';
  const statusIcon = token.is_active ? '✓' : '✗';
  const scopeBadge = getScopeBadge(token.scope);
  
  return `
    <div class="token-row" data-token-id="${token.id}">
      <div class="token-info">
        <div class="token-name">${escapeHtml(token.name)}</div>
        <div class="token-meta">
          <span class="badge ${statusClass}">${statusIcon} ${token.is_active ? 'Active' : 'Revoked'}</span>
          ${scopeBadge}
          <span class="token-id">ID: ${token.id.slice(0, 8)}...</span>
        </div>
      </div>
      <div class="token-details">
        <div class="detail-item">
          <span class="label">Created:</span>
          <span class="value">${formatDate(token.created_at)}</span>
        </div>
        <div class="detail-item">
          <span class="label">Last Used:</span>
          <span class="value">${token.last_used ? formatDate(token.last_used) : 'Never'}</span>
        </div>
        ${token.expires_at ? `
          <div class="detail-item">
            <span class="label">Expires:</span>
            <span class="value">${formatDate(token.expires_at)}</span>
          </div>
        ` : ''}
      </div>
      <div class="token-actions">
        ${token.is_active ? `
          <button class="btn btn-sm btn-danger action-revoke" data-token-id="${token.id}">
            Revoke
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function getScopeBadge(scope) {
  const badges = {
    admin: '<span class="badge scope-admin">Admin</span>',
    operator: '<span class="badge scope-operator">Operator</span>',
    viewer: '<span class="badge scope-viewer">Viewer</span>'
  };
  return badges[scope] || '<span class="badge scope-unknown">Unknown</span>';
}

function formatDate(timestamp) {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Initialize API keys panel event handlers
 */
export function initApiKeysPanel() {
  // Create token button
  document.getElementById('create-token-btn')?.addEventListener('click', () => {
    document.getElementById('create-token-modal').classList.remove('hidden');
  });

  document.getElementById('create-first-token-btn')?.addEventListener('click', () => {
    document.getElementById('create-token-modal').classList.remove('hidden');
  });

  // Modal close buttons
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.add('hidden');
      });
    });
  });

  // Create token form
  document.getElementById('create-token-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);

    try {
      const response = await fetch('/api/auth/tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (result.success) {
        // Close create modal
        document.getElementById('create-token-modal').classList.add('hidden');
        e.target.reset();

        // result.token is {id, token, name, scope, created_at, expires_at} — the raw secret is
        // the nested .token field (see handleCreateApiToken/generateToken), and it's the ONLY
        // time the server ever returns it (listTokens() never exposes it again), so it must be
        // captured now, before anything else touches the DOM.
        const secret = result.token.token;

        // Reload the tokens list FIRST — it replaces this whole panel's innerHTML (including both
        // modals), so setting the generated-token modal's content before this would just get
        // wiped out a moment later and the operator would never see their one-time secret.
        await loadApiTokens();

        document.getElementById('generated-token').textContent = secret;
        document.getElementById('token-created-modal').classList.remove('hidden');
      } else {
        showNotification(result.error || 'Failed to generate API key', 'error');
      }
    } catch (error) {
      showNotification('Failed to generate API key: ' + error.message, 'error');
    }
  });

  // Copy token button
  document.getElementById('copy-token-btn')?.addEventListener('click', () => {
    const token = document.getElementById('generated-token').textContent;
    navigator.clipboard.writeText(token).then(() => {
      showNotification('API key copied to clipboard', 'success');
    }).catch(() => {
      showNotification('Failed to copy API key', 'error');
    });
  });

  // Revoke token buttons
  if (_revokeListenerWired) return;
  _revokeListenerWired = true;
  document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('action-revoke')) {
      const tokenId = e.target.dataset.tokenId;

      if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
        return;
      }

      try {
        const response = await fetch(`/api/auth/tokens/${tokenId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`
          }
        });

        const result = await response.json();

        if (result.success) {
          showNotification('API key revoked successfully', 'success');
          loadApiTokens();
        } else {
          showNotification(result.error || 'Failed to revoke API key', 'error');
        }
      } catch (error) {
        showNotification('Failed to revoke API key: ' + error.message, 'error');
      }
    }
  });
}

/**
 * Load API tokens from API
 */
export async function loadApiTokens() {
  try {
    const response = await fetch('/api/auth/tokens', {
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });

    const result = await response.json();

    if (result.success) {
      const panel = document.querySelector('.api-keys-panel');
      if (panel) {
        panel.innerHTML = renderApiKeysPanel(result.tokens);
        initApiKeysPanel();
      }
    }
  } catch (error) {
    console.error('Failed to load API tokens:', error);
  }
}

/**
 * Get auth token from localStorage
 */
function getAuthToken() {
  return localStorage.getItem('meridianos_token');
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}