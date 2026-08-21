import { make, notice, page, table, formPanel, badge, instant } from '../../shared/view-helpers.mjs'; import { managementRequest } from '../../shared/management-actions.mjs';
export async function renderRoute(context) {
  const [members, invitations] = await Promise.all([managementRequest('/api/management/access/memberships'), managementRequest('/api/management/access/invitations')]); if (!context.isCurrent()) return;
  const view = page('Members and invitations', 'Invitation lifecycle and membership changes are enforced by the server within the selected scope.');
  const feedback = make('div', null, 'management-feedback'); feedback.setAttribute('role', 'status');
  const form = make('form', null, 'management-form');
  const email = make('input'); email.id = 'member-email'; email.type = 'email'; email.required = true; email.placeholder = 'user@example.com';
  const role = make('select'); role.id = 'member-role';
  for (const value of ['viewer', 'operator', 'admin']) { const option = make('option', value); option.value = value; role.append(option); }
  const invite = make('button', 'Invite member', 'btn-primary'); invite.type = 'submit';
  const emailLabel = make('label', 'Email'); emailLabel.htmlFor = email.id; emailLabel.append(email);
  const roleLabel = make('label', 'Role'); roleLabel.htmlFor = role.id; roleLabel.append(role);
  form.append(emailLabel, roleLabel, invite);
  form.addEventListener('submit', async (event) => { event.preventDefault(); try { const result = await managementRequest('/api/management/access/invitations', { method: 'POST', body: { email: email.value, role: role.value } }); feedback.textContent = `Invitation created · ${result.correlationId}`; void context.refresh(); } catch (error) { feedback.replaceChildren(notice(error.message, { error: true })); } });
  const formCard = formPanel(document, { title: 'Invite team member', icon: 'users', subtitle: 'Grant authorized tenant access by email and role.' }, form);
  const memberRows = members.memberships.map((member) => [
    member.email,
    badge(member.role, member.role === 'admin' ? 'info' : member.role === 'operator' ? 'warning' : 'ok'),
    `v${member.version}`
  ]);
  const invitationRows = invitations.invitations.map((item) => [
    item.email,
    badge(item.role, item.role === 'admin' ? 'info' : item.role === 'operator' ? 'warning' : 'ok'),
    badge(item.status, item.status === 'pending' ? 'warning' : item.status === 'expired' ? 'failed' : 'ok'),
    instant(item.expiresAt)
  ]);
  view.node.append(formCard, feedback, memberRows.length ? table(['Member', 'Role', 'Version'], memberRows, 'Scoped memberships') : notice('No members are listed in this scope.'), invitationRows.length ? table(['Invitation', 'Role', 'State', 'Expires'], invitationRows, 'Scoped invitations') : notice('No invitations are pending.'));
  context.root.replaceChildren(view.node);
}
