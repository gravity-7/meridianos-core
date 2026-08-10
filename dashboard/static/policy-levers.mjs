/**
 * policy-levers — 010 Frontend ES Module Migration, US8. The LEVERS batch-save/dirty-flag
 * mechanism and kill switch — 009's T027 explicitly declined to restructure this into per-field
 * saves (a real behavior change, not a mechanical port); this story moves the mechanism's code into
 * a module without changing what it does. Also includes renderQuiet (quiet-hours strip) and its
 * `inWin` helper — a top-level function this phase's own re-inventory found live and called
 * (from populateControls, a quiet-hours addEventListener, and a periodic setInterval) but never
 * named in spec.md/plan.md/tasks.md's original 64-function count; this is its one reasonable
 * home — it's a quiet-hours policy lever, defined right alongside this mechanism in the original
 * script, and populateControls already called it directly.
 *
 * `kill` is genuinely shared, mutable state — not just a function reference a `window.foo = foo`
 * bridge can cover. render(s)/poll() (dashboard/index.html, staying there until US9) both read and
 * write it, same as applyKill/populateControls/toggleKill here. `window.kill` is the shared
 * storage both sides read and write directly; functionally identical to the previous single-script
 * `let kill`, just relocated to survive the module boundary. `dirty` has no such split — every
 * reader and writer moves into this module — so it stays a plain module-private `let`.
 *
 * `fmt()` (syncReadouts) stays in dashboard/index.html — reached via `window.fmt`, the same bridge
 * spend-budget.mjs's renderFounderUsage/renderProviderCost already use.
 */
import { reportError } from './client-error-log.mjs';

window.kill = false;
let dirty = false;

const LEVERS=[
  ['warn','agent_budget.warn_pct','num'],['ptask','agent_budget.per_task_tokens','num'],
  ['autodown','agent_budget.auto_downgrade_at_warn','bool'],['attrib','agent_budget.attribution','str'],
  ['conc','work.max_parallel','num'],['wip','work.wip_per_agent','num'],['prio','work.priority_floor','num'],
  ['ttl','work.lease_ttl_min','num'],['maxruns','work.max_runs_per_5h','num'],['sched','schedule.cadence','str'],
  ['qhEnable','quiet_hours.enabled','bool'],['qhFrom','quiet_hours.from','str'],['qhTo','quiet_hours.to','str'],
  // 009 — Dashboard Modernization (US4/FR-009): govDeploy/govSend/govSpend/govSchema/autoMerge/esc(select)/
  // workSteal LEVERS entries removed along with their now-gone DOM elements — those levers save through
  // governance-panel.mjs's own saveLever() now (see that file).
];
const getPath=(o,p)=>p.split('.').reduce((a,k)=>a&&a[k],o);

export function setDirty(v){ dirty=v; document.getElementById('dirty').style.display=v?'inline':'none'; if(v) document.getElementById('saved').style.display='none'; }
export function applyKill(){ document.getElementById('aios').classList.toggle('killed',window.kill); document.getElementById('killbanner').style.display=window.kill?'flex':'none'; document.getElementById('dot').style.background=window.kill?'#e34948':'#0ca30c'; }

export function populateControls(policy){
  for(const [id,path,kind] of LEVERS){
    const el=document.getElementById(id); if(!el) continue;
    const v=getPath(policy,path); if(v==null) continue;
    if(kind==='bool'){ el.checked=!!v; }
    else { if(el.tagName==='SELECT' && ![...el.options].some(o=>o.value===String(v))){ const o=document.createElement('option'); o.value=String(v); o.textContent=String(v); el.appendChild(o); } el.value=v; }
  }
  window.kill=!!policy.kill_switch; document.getElementById('kill').checked=window.kill; applyKill();
  syncReadouts(); renderQuiet();
}
export function collectLevers(){ const u={}; for(const [id,path,kind] of LEVERS){ const el=document.getElementById(id); if(!el) continue; u[path]=kind==='bool'?el.checked:(kind==='num'?+el.value:el.value); } return u; }

export function syncReadouts(){
  // 009 — Dashboard Modernization (US1/FR-001): the per-agent cap-slider readout loop that used to
  // run here is gone along with agentBudgetTiles itself — agent-budget-panel.mjs updates its own
  // slider outputs directly (see wireAgentCard()'s 'input' listener there).
  if (document.getElementById('outWarn')) document.getElementById('outWarn').textContent=document.getElementById('warn').value+'%';
  if (document.getElementById('outPtask') && document.getElementById('ptask')) document.getElementById('outPtask').textContent=window.fmt(+document.getElementById('ptask').value);
  if (document.getElementById('outConc')) document.getElementById('outConc').textContent=document.getElementById('conc').value;
  if (document.getElementById('outWip')) document.getElementById('outWip').textContent=document.getElementById('wip').value;
  if (document.getElementById('outTtl')) document.getElementById('outTtl').textContent=document.getElementById('ttl').value;
  if (document.getElementById('outMaxruns')) document.getElementById('outMaxruns').textContent=document.getElementById('maxruns').value;
}
const inWin=(h,f,e)=> f===e?false:(f<e?(h>=f&&h<e):(h>=f||h<e));
export function renderQuiet(){
  const on=document.getElementById('qhEnable').checked, from=document.getElementById('qhFrom').value||'00:00', to=document.getElementById('qhTo').value||'00:00';
  const f=parseInt(from,10)||0, e=parseInt(to,10)||0, nh=new Date().getHours(), strip=document.getElementById('qhStrip');
  strip.innerHTML='';
  for(let h=0;h<24;h++){ const c=document.createElement('div'); c.style.flex='1'; c.style.height='18px'; c.style.borderRadius='3px'; const q=on&&inWin(h,f,e); c.style.background=q?'var(--surface-0)':'var(--bg-accent)'; if(q)c.style.border='.5px solid var(--border)'; if(h===nh)c.style.boxShadow='inset 0 0 0 2px var(--text-primary)'; strip.appendChild(c); }
  document.getElementById('qhStatus').textContent = !on ? 'always on — no quiet window' : (inWin(nh,f,e)?('sleeping — resumes at '+to):('active now · agents sleep '+from+'–'+to));
}

export async function save(){
  try{ const r=await fetch('/api/policy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(collectLevers())});
    const j=await r.json();
    if(j.ok){ setDirty(false); document.getElementById('saved').style.display='inline-flex'; } else { document.getElementById('dirty').textContent='save failed: '+j.error; }
  }catch(e){ document.getElementById('dirty').textContent='save failed: '+e.message; document.getElementById('dirty').style.display='inline'; }
}

export async function toggleKill(){
  const previousKill = window.kill;
  window.kill=document.getElementById('kill').checked; applyKill();
  try{
    await fetch('/api/policy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kill_switch:window.kill})});
  }catch(e){
    reportError('toggleKill', e);
    // The write failed — the checkbox must not silently show a state that was never actually
    // persisted server-side. This is the master kill switch; a UI/server mismatch here is exactly
    // the kind of thing that must never be silent (this was previously an empty catch block).
    window.kill = previousKill; document.getElementById('kill').checked = window.kill; applyKill();
    alert('Failed to update the kill switch — the change was NOT saved. ' + e.message);
  }
}

// 009 — Dashboard Modernization (US4/FR-009): 'gov' removed from this list — the #gov card it
// referenced no longer exists (governance levers moved to governance-panel.mjs, which wires its own
// listeners directly). Leaving it in would null-deref on every page load, exactly the class of bug
// this phase's US3 work exists to catch instead of silently break everything downstream.
['ctrls','work'].forEach(cid=>{ const c=document.getElementById(cid); const h=()=>{ setDirty(true); syncReadouts(); }; c.addEventListener('input',h); c.addEventListener('change',h); });
['qhEnable','qhFrom','qhTo'].forEach(id=>document.getElementById(id).addEventListener('change',(e)=>{ renderQuiet(); setDirty(true); }));
document.getElementById('save').addEventListener('click',save);
document.getElementById('kill').addEventListener('change',toggleKill);
setInterval(renderQuiet,60000);
