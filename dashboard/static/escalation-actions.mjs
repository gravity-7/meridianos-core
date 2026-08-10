/**
 * escalation-actions — 010 Frontend ES Module Migration, US2. The escalation feed's action buttons
 * (Approve/Snooze/Skip/Dismiss), the parked-task unpark controls, and the spec modal (open/comment/
 * save/close/bounce) — already-incurred cross-module dependencies, not hypothetical ones:
 * governance-panel.mjs and task-workflow-panel.mjs already call several of these as `window` globals
 * from their generated HTML's `onclick` attributes (009's own doc comments there note this
 * directly). Every export reached that way keeps a `window.foo = foo` bridge (FR-005) so none of
 * those call sites need to change.
 *
 * `postAction` calls `poll()` on success, same as it always has — `poll()` itself doesn't move
 * until US9, so `window.poll` (bridged in dashboard/index.html) is what lets this already-moved
 * function call back into the not-yet-moved one.
 */
import { esc } from './dashboard-utils.mjs';

export async function postAction(endpoint, payload) {
  try {
    const r = await fetch(endpoint, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!j.ok) { document.getElementById('dirty').textContent = 'action failed: ' + j.error; document.getElementById('dirty').style.display = 'inline'; }
    else window.poll();
  } catch (e) { document.getElementById('dirty').textContent = 'action failed: ' + e.message; document.getElementById('dirty').style.display = 'inline'; }
}
window.postAction = postAction;

export function actEsc(id, ep, pay) {
  const endpoint = ep ? decodeURIComponent(ep) : '/api/escalation';
  const payload = pay ? JSON.parse(decodeURIComponent(pay)) : {id, action: 'ack'};
  postAction(endpoint, payload);
}
window.actEsc = actEsc;

// Founder approves a §6 governance hold → unblock the task back into the pipeline. The server
// records the approval so the planner won't immediately re-block it.
export function unblockEsc(task) {
  if (!confirm(`Approve and unblock ${task}?\n\nThis clears the §6 governance hold so agents may work it (e.g. spend money / send external). Proceed only if you approve that action.`)) return;
  postAction('/api/task', { id: task, action: 'unblock' });
}
window.unblockEsc = unblockEsc;

// Snooze/skip park a blocked task WITHOUT approving the underlying spend/external/deploy/schema
// action — status stays 'blocked', it just stops nagging the escalation feed until it resurfaces
// (snooze) or until the founder reverses it from the "Snoozed / Skipped" section (either).
export function snoozeEsc(task, days, sel) {
  if (sel) sel.selectedIndex = 0;
  postAction('/api/task', { id: task, action: 'snooze', days: Number(days) });
}
window.snoozeEsc = snoozeEsc;

export function skipEsc(task) {
  const reason = prompt(`Optional reason for skipping ${task} (leave blank to skip without one):`, '');
  if (reason === null) return; // cancelled
  postAction('/api/task', { id: task, action: 'skip', reason: reason || undefined });
}
window.skipEsc = skipEsc;

let parkedOpen = false;
export function toggleParked() {
  parkedOpen = !parkedOpen;
  document.getElementById('parkedList').style.display = parkedOpen ? 'block' : 'none';
  document.getElementById('parkedCaret').textContent = parkedOpen ? '▾' : '▸';
}
window.toggleParked = toggleParked;

export function renderParked(list) {
  const panel = document.getElementById('parkedPanel'), el = document.getElementById('parkedList'), count = document.getElementById('parkedCount');
  if (!list || !list.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  count.textContent = '(' + list.length + ')';
  el.innerHTML = list.map(p => {
    const badge = p.skipped
      ? '<span class="badge b-muted">skipped</span>'
      : `<span class="badge b-muted">snoozed → ${p.snoozedUntil ? new Date(p.snoozedUntil).toLocaleString() : '—'}</span>`;
    const unpark = p.skipped
      ? `<button onclick="postAction('/api/task', {id:'${esc(p.task)}', action:'unskip'})" style="font-size:11px;padding:4px 8px">Un-skip</button>`
      : `<button onclick="postAction('/api/task', {id:'${esc(p.task)}', action:'unsnooze'})" style="font-size:11px;padding:4px 8px">Un-snooze</button>`;
    return `<div class="row" style="align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="mono" style="font-size:13px">${esc(p.task)}</span>
          ${badge}
          <span style="font-size:11px;color:var(--text-muted)">${esc(p.owner||'')}</span>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${esc(p.note||'')}</div>
      </div>
      <div style="margin-left:12px;display:flex;gap:6px">
        ${unpark}
        <button onclick="unblockEsc('${esc(p.task)}')" style="font-size:11px;padding:4px 8px;color:var(--text-success);border-color:var(--text-success)">Approve</button>
      </div>
    </div>`;
  }).join('');
}

export function copySession(sess, agent) {
  const cmd = agent === 'antigravity' ? `agy --session ${sess}` : `claude --session-id ${sess}`;
  navigator.clipboard.writeText(cmd).then(() => {
    const el = document.getElementById('copyToast');
    el.textContent = 'copied: ' + cmd;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 2000);
  });
}
window.copySession = copySession;

export function defaultSpecPath(id){ return '.ai/features/'+id+'/spec.md'; }
window.defaultSpecPath = defaultSpecPath;

let specDirty = false;

// `taskStatus`/`taskOwner` are only passed when opening from an escalation/parked-task control
// (the founder already knows this is a real task, not a "next up" queue card). When present AND
// the spec file is missing, show a read-only task summary instead of a misleading blank editor
// with "new file — type your spec and hit Save" (queue cards, which pass neither, are unchanged).
export async function openSpec(id, path, reason, taskStatus, taskOwner){
  const overlay=document.getElementById('specOverlay'), ta=document.getElementById('specTextarea'), status=document.getElementById('specStatus'), summary=document.getElementById('specSummary'), saveBtn=document.getElementById('specSave');
  const bounceBtn=document.getElementById('specBounce');
  document.getElementById('specTitle').textContent=id; document.getElementById('specPath').textContent=path;
  const reasonEl=document.getElementById('specReason'), reasonText=document.getElementById('specReasonText');
  if(reason){ reasonText.textContent=reason; reasonEl.style.display='block'; } else { reasonEl.style.display='none'; }
  status.textContent=''; specDirty=false; overlay.style.display='flex';
  const hasTaskInfo = !!(taskStatus || taskOwner);
  summary.style.display='none'; ta.style.display=''; saveBtn.style.display='';
  // G2: show Bounce button only where taskAction can actually bounce — see the bounceMap in
  // dashboard/actions.mjs, which mirrors machine.mjs's backward edges. Offering it on the further
  // upstream stages (designing, spec) just produced an "illegal transition" toast.
  const bounceable = new Set(['ready-for-impl','in-review']);
  if(bounceBtn) bounceBtn.style.display = (taskStatus && bounceable.has(taskStatus)) ? '' : 'none';
  if(bounceBtn) bounceBtn.dataset.taskId = id;
  if(bounceBtn) bounceBtn.dataset.taskStatus = taskStatus || '';
  ta.value='loading…'; ta.disabled=true;
  try{
    const r=await fetch('/api/spec?path='+encodeURIComponent(path));
    const j=await r.json();
    if(!j.ok){ ta.value=''; status.textContent='load failed: '+j.error; }
    else if(!j.content && hasTaskInfo){
      // No spec file for this task — a blank "new file" editor would be misleading here, since
      // this task was opened from the escalation/parked feed, not the "write a spec" queue.
      ta.style.display='none'; saveBtn.style.display='none';
      summary.style.display='block';
      summary.innerHTML = `<div style="color:var(--text-muted);font-size:12px;margin-bottom:12px">No spec file (auto-generated) — showing task details.</div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 14px">
          <div style="color:var(--text-secondary)">ID</div><div class="mono">${esc(id)}</div>
          <div style="color:var(--text-secondary)">Status</div><div>${esc(taskStatus||'—')}</div>
          <div style="color:var(--text-secondary)">Owner</div><div>${esc(taskOwner||'—')}</div>
          <div style="color:var(--text-secondary)">Reason</div><div>${esc(reason||'—')}</div>
        </div>`;
    } else {
      ta.value=j.content||'';
      if(!j.content) status.textContent='new file — type your spec and hit Save';
    }
  }catch(e){ ta.value=''; status.textContent='load failed: '+e.message; }
  ta.disabled=false;
  loadSpecComments(id);
}
window.openSpec = openSpec;

// 008 — Team Collaboration (US3): comments on the currently-open spec/task, using the same
// per-user JWT session as the Team workspace (auth-client.mjs) — not the shared __AIOS_TOKEN__
// dashboard/index.html's other fetches use, since comments need a real author, not "the dashboard".
export async function loadSpecComments(taskId){
  const mount = document.getElementById('specComments');
  mount.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Loading comments…</div>';
  const { renderTaskComments } = await import('./task-comments.mjs');
  const { getToken, authFetch, renderLoginPrompt } = await import('./auth-client.mjs');
  if(!getToken()){
    renderLoginPrompt(mount, ()=>loadSpecComments(taskId));
    return;
  }
  const res = await authFetch('/api/tasks/'+encodeURIComponent(taskId)+'/comments');
  if(!res){ renderLoginPrompt(mount, ()=>loadSpecComments(taskId)); return; }
  const result = await res.json();
  const comments = result.success ? result.comments : [];
  mount.innerHTML = renderTaskComments(taskId, comments);
  mount.querySelector('.add-comment-form')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const textarea = mount.querySelector('.comment-input');
    const content = textarea.value.trim();
    if(!content) return;
    const postRes = await authFetch('/api/tasks/'+encodeURIComponent(taskId)+'/comments', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({content}),
    });
    const postResult = postRes && await postRes.json();
    if(!postResult?.success){ alert('Comment failed: '+(postResult?.error||'unknown error')); return; }
    loadSpecComments(taskId);
  });
}

export function closeSpec(){
  if(specDirty && !confirm('Discard unsaved changes to this spec?')) return;
  document.getElementById('specOverlay').style.display='none';
}

export async function saveSpec(){
  const path=document.getElementById('specPath').textContent, status=document.getElementById('specStatus');
  status.textContent='saving…';
  try{
    const r=await fetch('/api/spec',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path, content:document.getElementById('specTextarea').value})});
    const j=await r.json();
    if(j.ok){ specDirty=false; status.textContent='saved'; setTimeout(()=>{ if(status.textContent==='saved') status.textContent=''; },2000); }
    else status.textContent='save failed: '+j.error;
  }catch(e){ status.textContent='save failed: '+e.message; }
}

document.getElementById('specTextarea').addEventListener('input',()=>{ specDirty=true; });
document.getElementById('specClose').addEventListener('click',closeSpec);
document.getElementById('specCancel').addEventListener('click',closeSpec);
document.getElementById('specSave').addEventListener('click',saveSpec);
// G2: Bounce button — sends the task one stage back for the agent to redo
document.getElementById('specBounce').addEventListener('click', async function() {
  const id = this.dataset.taskId;
  const status = this.dataset.taskStatus;
  if (!id) return;
  const reason = prompt(`Why bouncing ${id} (${status}) back? (optional — leave blank to skip)`) ?? '';
  if (reason === null) return; // cancelled
  const r = await postAction('/api/task', { id, action: 'bounce', reason: reason || undefined });
  if (r && r.ok) { closeSpec(); } else { document.getElementById('specStatus').textContent = 'bounce failed: ' + (r?.error || 'unknown'); }
});
document.getElementById('specOverlay').addEventListener('click',(e)=>{ if(e.target.id==='specOverlay') closeSpec(); });
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && document.getElementById('specOverlay').style.display==='flex') closeSpec(); });
