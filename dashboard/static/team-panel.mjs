/**
 * Team Panel UI
 * Displays project team members, invitation form, and activity feed
 */

export function renderTeamPanel(members = [], activities = [], projectOwner = null) {
  return `
    <div class="team-panel">
      <div class="panel-header">
        <h2>Team Members</h2>
        <button id="invite-member-btn" class="btn btn-primary">
          <span class="icon">+</span> Invite Member
        </button>
      </div>

      <div class="members-list">
        ${members.length === 0 ? renderEmptyMembers() : members.map(m => renderMemberCard(m, projectOwner)).join('')}
      </div>

      <div class="panel-header" style="margin-top: 2rem;">
        <h2>Activity Feed</h2>
      </div>
      
      <div class="activity-feed">
        ${activities.length === 0 ? renderEmptyActivity() : activities.map(renderActivityItem).join('')}
      </div>

      <div id="invite-member-modal" class="modal hidden">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Invite Team Member</h3>
            <button class="close-btn">&times;</button>
          </div>
          <div class="modal-body">
            <form id="invite-member-form">
              <div class="form-group">
                <label for="invite-email">Email Address</label>
                <input type="email" id="invite-email" required placeholder="colleague@example.com">
              </div>
              <div class="form-group">
                <label for="invite-role">Role</label>
                <select id="invite-role" required>
                  <option value="viewer">Viewer</option>
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div class="form-actions">
                <button type="button" class="btn btn-secondary cancel-btn">Cancel</button>
                <button type="submit" class="btn btn-primary">Send Invitation</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderEmptyMembers() {
  return `
    <div class="empty-state">
      <div class="empty-icon">👥</div>
      <h3>No team members yet</h3>
      <p>Invite your team members to collaborate on this project.</p>
    </div>
  `;
}

function renderMemberCard(member, projectOwner) {
  const isOwner = projectOwner && projectOwner.id === member.id;
  const statusClass = member.accepted_at ? 'status-active' : 'status-pending';
  const statusText = member.accepted_at ? 'Active' : 'Pending';

  return `
    <div class="member-card" data-id="${member.id}">
      <div class="member-info">
        <div class="member-avatar">${member.username ? member.username.substring(0, 2).toUpperCase() : '??'}</div>
        <div class="member-details">
          <h4>${member.username || 'Unknown'} ${isOwner ? '<span class="badge">Owner</span>' : ''}</h4>
          <p class="member-email">${member.email}</p>
        </div>
      </div>
      <div class="member-meta">
        <span class="status-indicator ${statusClass}">${statusText}</span>
        <span class="member-role">${member.role || 'Member'}</span>
      </div>
      <div class="member-actions">
        ${!isOwner ? `
          <button class="btn btn-sm btn-outline change-role-btn" data-id="${member.id}">Change Role</button>
          <button class="btn btn-sm btn-danger remove-member-btn" data-id="${member.id}">Remove</button>
        ` : ''}
      </div>
    </div>
  `;
}

function renderEmptyActivity() {
  return `
    <div class="empty-state">
      <div class="empty-icon">📝</div>
      <h3>No activity yet</h3>
      <p>Project activities will appear here.</p>
    </div>
  `;
}

function renderActivityItem(activity) {
  const date = new Date(activity.timestamp).toLocaleString();
  return `
    <div class="activity-item">
      <div class="activity-time">${date}</div>
      <div class="activity-content">
        <span class="activity-user">${activity.username || 'System'}</span>
        <span class="activity-action">${formatAction(activity.action)}</span>
        <span class="activity-resource">${activity.resource_type || ''}</span>
      </div>
    </div>
  `;
}

function formatAction(action) {
  return action.replace(/_/g, ' ').toLowerCase();
}
