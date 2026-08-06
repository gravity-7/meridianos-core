/**
 * Billing Panel - Subscription management UI
 *
 * Displays license status, upgrade CTAs, and subscription management
 */
import { authFetch } from './auth-client.mjs';

export function renderBillingPanel() {
  return `
    <div id="billing-panel" class="panel">
      <div class="panel-header">
        <h2>Billing & Subscription</h2>
        <button id="refresh-billing" class="btn-secondary">Refresh</button>
      </div>

      <div id="billing-content">
        <div class="loading">Loading billing information...</div>
      </div>

      <div id="billing-error" class="error-message" style="display: none;"></div>
    </div>
  `;
}

export function initBillingPanel() {
  const refreshButton = document.getElementById('refresh-billing');
  if (refreshButton) {
    refreshButton.addEventListener('click', loadBillingInfo);
  }

  // Initial load
  loadBillingInfo();
}

async function loadBillingInfo() {
  const content = document.getElementById('billing-content');
  const error = document.getElementById('billing-error');

  try {
    const response = await authFetch('/api/billing/license');
    if (!response) {
      content.innerHTML = renderFreeTier();
      error.textContent = 'Your session expired — switch tabs and sign back in to see your real billing status.';
      error.style.display = 'block';
      return;
    }
    const data = await response.json();

    if (data.success) {
      content.innerHTML = renderLicenseStatus(data.license, data.usage);
      error.style.display = 'none';
    } else {
      content.innerHTML = renderFreeTier();
      error.style.display = 'none';
    }
  } catch (err) {
    content.innerHTML = renderFreeTier();
    error.textContent = 'Failed to load billing information';
    error.style.display = 'block';
  }
}

function renderLicenseStatus(license, usage) {
  const tier = license.tier;
  const features = license.features || [];
  const expiresAt = new Date(license.expires_at * 1000);
  const daysUntilExpiry = Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24));

  return `
    <div class="license-status">
      <div class="license-header">
        <div class="tier-badge tier-${tier}">${tier.toUpperCase()}</div>
        <div class="license-key">${license.license_key}</div>
      </div>

      <div class="license-details">
        <div class="detail-row">
          <span class="label">Status:</span>
          <span class="value status-${license.status}">${license.status}</span>
        </div>
        <div class="detail-row">
          <span class="label">Expires:</span>
          <span class="value">${expiresAt.toLocaleDateString()} (${daysUntilExpiry} days)</span>
        </div>
        <div class="detail-row">
          <span class="label">Customer ID:</span>
          <span class="value">${license.customer_id}</span>
        </div>
        <div class="detail-row">
          <span class="label">Last Validated:</span>
          <span class="value">${new Date(license.last_validated * 1000).toLocaleString()}</span>
        </div>
      </div>

      <div class="usage-section">
        <h3>Usage</h3>
        <div class="usage-metrics">
          <div class="metric">
            <div class="metric-label">Seats Used</div>
            <div class="metric-value">${usage.seats_used} / ${usage.seats_limit}</div>
            <div class="metric-bar">
              <div class="metric-fill" style="width: ${(usage.seats_used / usage.seats_limit) * 100}%"></div>
            </div>
          </div>
          <div class="metric">
            <div class="metric-label">Projects</div>
            <div class="metric-value">${usage.projects_count}</div>
          </div>
        </div>
      </div>

      <div class="features-section">
        <h3>Enabled Features</h3>
        <div class="features-grid">
          ${features.map(feature => `
            <div class="feature-item">
              <span class="feature-icon">✓</span>
              <span class="feature-name">${formatFeatureName(feature)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="billing-actions">
        <button id="manage-subscription" class="btn-primary">Manage Subscription</button>
        <button id="refresh-license" class="btn-secondary">Refresh License</button>
      </div>
    </div>
  `;
}

function renderFreeTier() {
  return `
    <div class="free-tier">
      <div class="tier-badge tier-free">FREE TIER</div>
      <p>You're using the free tier with limited features.</p>
      
      <div class="features-section">
        <h3>Free Tier Features</h3>
        <ul class="features-list">
          <li>✓ 1 project</li>
          <li>✓ 3 agents</li>
          <li>✓ 1 user seat</li>
          <li>✓ $100 monthly spend limit</li>
          <li>✓ Local dashboard only</li>
        </ul>
      </div>

      <div class="upgrade-section">
        <h3>Upgrade to Pro</h3>
        <ul class="pro-features">
          <li>✓ 10 projects</li>
          <li>✓ 50 agents</li>
          <li>✓ 10 user seats</li>
          <li>✓ $1,000 monthly spend limit</li>
          <li>✓ Remote dashboard</li>
          <li>✓ Team collaboration</li>
          <li>✓ Project templates</li>
          <li>✓ API access</li>
        </ul>
        <div class="pricing">
          <span class="price">$29</span>
          <span class="period">/month</span>
          <span class="yearly">or $290/year (save 17%)</span>
        </div>
        <button id="upgrade-pro" class="btn-primary">Upgrade to Pro</button>
      </div>

      <div class="enterprise-section">
        <h3>Enterprise</h3>
        <p>Need unlimited resources and priority support?</p>
        <button id="contact-sales" class="btn-secondary">Contact Sales</button>
      </div>
    </div>
  `;
}

function formatFeatureName(feature) {
  return feature
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Event handlers
document.addEventListener('click', async (e) => {
  if (e.target.id === 'manage-subscription') {
    await openCustomerPortal();
  } else if (e.target.id === 'refresh-license') {
    await refreshLicense();
  } else if (e.target.id === 'upgrade-pro') {
    await startCheckout('pro');
  } else if (e.target.id === 'contact-sales') {
    window.open('mailto:sales@meridianos.com?subject=Enterprise Inquiry', '_blank');
  }
});

async function openCustomerPortal() {
  try {
    const response = await authFetch('/api/billing/portal');
    if (!response) return alert('Your session expired — switch tabs and sign back in.');
    const data = await response.json();

    if (data.success) {
      window.open(data.portal_url, '_blank');
    } else {
      alert('Failed to open customer portal: ' + data.error);
    }
  } catch (err) {
    alert('Failed to open customer portal: ' + err.message);
  }
}

async function refreshLicense() {
  try {
    const response = await authFetch('/api/billing/license/refresh', {
      method: 'POST'
    });
    if (!response) return alert('Your session expired — switch tabs and sign back in.');
    const data = await response.json();

    if (data.success) {
      alert('License refreshed successfully');
      loadBillingInfo();
    } else {
      alert('Failed to refresh license: ' + data.error);
    }
  } catch (err) {
    alert('Failed to refresh license: ' + err.message);
  }
}

async function startCheckout(tier) {
  try {
    const response = await authFetch('/api/billing/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tier,
        seats: 1
      })
    });
    if (!response) return alert('Your session expired — switch tabs and sign back in.');
    const data = await response.json();

    if (data.success) {
      window.open(data.checkout_url, '_blank');
    } else {
      alert('Failed to start checkout: ' + data.error);
    }
  } catch (err) {
    alert('Failed to start checkout: ' + err.message);
  }
}