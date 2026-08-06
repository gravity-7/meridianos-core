/**
 * Team Panel UI
 * Displays project team members, invitation form, and activity feed.
 *
 * `members`/`activities` come straight off GET /api/projects/:id/members and
 * GET /api/projects/:id/activity (dashboard/server.mjs) — member shape is
 * {id, email, full_name, github_username, role, joined_at} (there is no separate
 * "username" column anywhere in the schema, and no "pending" member state: pending
 * invites live in a different list, not here). Activity items are ActivityLogger's
 * enriched rows: {timestamp (unix seconds), user_name, action, action_display, ...}.
 *
 * `canManage` is whether the VIEWING user is admin on this project (server-computed,
 * passed in by the caller) — there's no "project owner" concept in the schema to
 * derive it from client-side.
 */
export function renderTeamPanel(members = [], activities = [], canManage = false) {
  return `
    <div class="team-panel">
      <div class="panel-header">
        <h2>Team Members</h2>
        ${canManage ? `
        <button id="invite-member-btn" class="btn btn-primary">
          <span class="icon">+</span> Invite Member
        </button>` : ''}
      </div>

      <div class="members-list">
        ${members.length === 0 ? renderEmptyMembers() : members.map(m => renderMemberCard(m, canManage)).join('')}
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

function renderMemberCard(member, canManage) {
  const displayName = member.full_name || member.email;
  const initials = displayName ? displayName.substring(0, 2).toUpperCase() : '??';

  return `
    <div class="member-card" data-id="${member.id}">
      <div class="member-info">
        <div class="member-avatar">${initials}</div>
        <div class="member-details">
          <h4>${displayName || 'Unknown'}</h4>
          <p class="member-email">${member.email}</p>
        </div>
      </div>
      <div class="member-meta">
        <span class="member-role">${member.role || 'viewer'}</span>
      </div>
      <div class="member-actions">
        ${canManage ? `
          <button class="btn btn-sm btn-outline change-role-btn" data-id="${member.id}" data-role="${member.role}">Change Role</button>
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
  // ActivityLogger stores `timestamp` in unix SECONDS (Math.floor(Date.now()/1000)) — Date()
  // needs milliseconds.
  const date = new Date(activity.timestamp * 1000).toLocaleString();
  return `
    <div class="activity-item">
      <div class="activity-time">${date}</div>
      <div class="activity-content">
        <span class="activity-user">${activity.user_name || 'System'}</span>
        <span class="activity-action">${activity.action_display || formatAction(activity.action)}</span>
      </div>
    </div>
  `;
}

function formatAction(action) {
  return action.replace(/_/g, ' ').toLowerCase();
}
