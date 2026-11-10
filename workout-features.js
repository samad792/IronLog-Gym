'use strict';
// Uses the existing account-scoped data/draft persistence and Firebase bridge.
const activeExercises = () => data.exercises.filter(e => !e.archived);
const defaultRoutine = category => data.templates.find(t => t.category === category && t.isDefault);
const availableRoutineExercises = template => (template?.exercises || []).filter(e => exById(e.exerciseId) && !exById(e.exerciseId).archived);
function commitRoutineData(change) {
  const previous = clone(data);
  change();
  if (persist()) return true;
  data = previous;
  return false;
}
function routineSessionExercises(template) {
  return availableRoutineExercises(template).map(e => {
    const last = lastEx(e.exerciseId);
    return { exerciseId:e.exerciseId, collapsed:true, sets:(e.sets?.length ? e.sets : [blankRoutineSet()]).map((s,i) => ({...clone(last?.sets[i] || s), warmup:!!s.warmup})) };
  });
}
function blankRoutineSet() { return {weight:'',reps:8,rpe:'',warmup:false}; }
startWorkout = function(category='PUSH') {
  if (draft && !confirm('Replace your saved workout draft with a new session?')) return;
  draft = {id:id(),date:date(),category,notes:'',exercises:routineSessionExercises(defaultRoutine(category))};
  saveDraft();
  navigate('workout');
};
const baseWorkoutExHTML = workoutExHTML;
function exerciseSetSummary(e) {
  const sets = e.sets || [];
  const volume = sets.filter(s => !s.warmup && s.weight !== '' && n(s.reps)>0).reduce((sum,s) => sum+n(s.weight)*n(s.reps),0);
  return sets.length+' set'+(sets.length===1?'':'s')+' · '+fmt(volume)+' kg volume';
}
workoutExHTML = function(e,i) {
  const x = exById(e.exerciseId);
  const original = baseWorkoutExHTML(e,i);
  const body = original.slice(original.indexOf('<div class="setrow set-head"'), -6);
  return `<details class="workout-ex exercise-fold" data-exercise-index="${i}" ${e.collapsed ? '' : 'open'} ontoggle="if(this.isConnected)rememberExerciseFold(${i},this.open)">
    <summary><span class="exercise-summary-text"><span class="pill subtle">${esc(x?.category || 'EXERCISE')}</span><strong>${esc(x?.name || 'Exercise')}</strong><span class="muted tiny exercise-set-summary">${esc(exerciseSetSummary(e))}</span></span><span class="fold-indicator" aria-hidden="true">⌄</span></summary>
    <div class="exercise-body">${body}<div class="exercise-remove">${button('Remove from session',`removeWorkoutEx(${i})`,'small danger')}</div></div></details>`;
};
function rememberExerciseFold(i,open) {
  const e = draft?.exercises[i];
  if (!e || !!e.collapsed === !open) return;
  e.collapsed = !open;
  saveDraft();
}
function foldAllExercises(collapsed) {
  if (!draft) return;
  draft.exercises.forEach(e => e.collapsed = collapsed);
  saveDraft();
  document.querySelectorAll('.exercise-fold').forEach(el => el.open = !collapsed);
}
const baseChangeSet = changeSet;
changeSet = function(i,j,key,value) {
  baseChangeSet(i,j,key,value);
  const label = document.querySelector(`[data-exercise-index="${i}"] .exercise-set-summary`);
  if (label && draft?.exercises[i]) label.textContent = exerciseSetSummary(draft.exercises[i]);
};
pickExercise = function(eid) {
  const x = exById(eid);
  if (!draft || !x || x.archived) return;
  if (draft.exercises.some(e => e.exerciseId===eid)) return toast('Exercise already added');
  draft.exercises.forEach(e => e.collapsed = true);
  const last = lastEx(eid);
  draft.exercises.push({exerciseId:eid,collapsed:false,sets:last?.sets.length ? clone(last.sets) : [blankRoutineSet()]});
  saveDraft(); closeModal(); renderWorkout();
};
const baseFilterPick = filterPick;
filterPick = function(q) {
  baseFilterPick(q);
  const buttons = document.querySelectorAll('#exPick button');
  const matched = data.exercises.filter(e => (e.name+' '+e.category).toLowerCase().includes(q.toLowerCase()));
  buttons.forEach((b,i) => {if (matched[i]?.archived) b.remove();});
  if (!document.querySelector('#exPick button')) document.getElementById('exPick').innerHTML='<div class="empty">No matching exercises. Create one in your library.</div>';
};
const baseRenderWorkout = renderWorkout;
renderWorkout = function() {
  baseRenderWorkout();
  const view = document.getElementById('workout');
  const tools = document.createElement('div');
  tools.className='actions routine-tools';
  tools.innerHTML=button('Exercise library',"navigate('exercises')",'small')+button('Manage templates','showTemplates()','small');
  if (draft) tools.innerHTML += button('Save as template',"editRoutine(null,draft.category,'draft')",'small')+button('Fold all','foldAllExercises(true)','small')+button('Expand all','foldAllExercises(false)','small');
  if (draft) view.querySelector('.workout-meta-panel').after(tools);
  else view.querySelector('.subline').after(tools);
  showSaveStatus();
};
const baseRenderDashboard = renderDashboard;
renderDashboard = function() {
  baseRenderDashboard();
  const cards = document.querySelectorAll('#dashboard > .grid.cols3 > .panel');
  cards.forEach((card,i) => {
    const category=data.categories[i], template=defaultRoutine(category);
    const caption=document.createElement('p'); caption.className='routine-caption';
    caption.textContent=template ? template.name+' · '+availableRoutineExercises(template).length+' exercises' : 'Choose exercises to preload this split.';
    card.querySelector('h2').after(caption);
    const actions=document.createElement('div');actions.className='routine-card-action';
    actions.innerHTML=button(template ? 'Edit routine' : 'Set up routine',`editRoutine(${template ? jsArg(template.id) : 'null'},${jsArg(category)})`,'small wide');
    card.append(actions);
  });
};
renderExercises = function() {
  const exercises=activeExercises(),removed=data.exercises.length-exercises.length;
  document.getElementById('exercises').innerHTML=`<div class="row" style="flex-wrap:wrap"><div><h1>Exercise library</h1><p class="subline">Your exercises, your splits. Edit or remove any exercise, including the defaults.</p></div><div class="actions">${button('＋ New exercise','newExerciseModal()','primary')}${button('Build a template','editRoutine()')}</div></div>
    <div class="panel"><div class="row" style="flex-wrap:wrap"><input class="input search" aria-label="Filter exercises" placeholder="Filter exercises..." oninput="document.querySelectorAll('.library-ex').forEach(e=>e.hidden=!e.textContent.toLowerCase().includes(this.value.toLowerCase()))"><span class="muted">${exercises.length} exercises</span></div><div class="divider"></div><div class="grid cols3">${exercises.map(x=>`<div class="exercise-card library-ex"><span class="pill">${esc(x.category)}</span><div class="name" style="margin:12px 0 6px">${esc(x.name)}</div><div class="muted tiny">${esc(x.muscle || 'General')}</div><div class="actions library-actions">${button('View',`showExerciseDetails(${jsArg(x.id)})`,'small')}${button('Edit',`editLibraryExercise(${jsArg(x.id)})`,'small')}${button('Remove',`removeLibraryExercise(${jsArg(x.id)})`,'small danger')}</div></div>`).join('') || '<div class="empty">Your library is empty. Add your first exercise above.</div>'}</div></div>
    <div class="sectionhead"><h2>Custom splits</h2>${button('＋ Add split','newCategoryModal()')}</div><div class="actions">${data.categories.map(c=>`<span class="pill subtle">${esc(c)}</span>`).join('')}</div><div class="sectionhead"><h2>Removed exercises</h2>${button('Manage removed ('+removed+')','showRemovedExercises()','small')}</div><p>Removing an exercise hides it from the library and future templates. Your logged history and current session remain intact.</p>`;
};
newExerciseModal = function() { editLibraryExercise(); };
function editLibraryExercise(eid=null) {
  const e=eid ? exById(eid) : null;
  if (eid && !e) return;
  modal(`<h2>${e?'Edit':'Add'} exercise</h2><div class="stack"><label class="field">Exercise name<input id="newExName" class="input" value="${esc(e?.name || '')}" placeholder="e.g. Incline Smith Press"></label><label class="field">Training split<select id="newExCat">${data.categories.map(c=>`<option ${c===e?.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label class="field">Muscle group<input id="newExMuscle" class="input" value="${esc(e?.muscle || '')}" placeholder="e.g. Chest"></label>${button('Save exercise',`saveLibraryExercise(${eid ? jsArg(eid) : 'null'})`,'primary wide')}</div>`);
}
function saveLibraryExercise(eid) {
  const name=document.getElementById('newExName').value.trim(),category=document.getElementById('newExCat').value,muscle=document.getElementById('newExMuscle').value.trim();
  if (!name) return toast('Enter an exercise name');
  if (data.exercises.some(e=>e.id!==eid && !e.archived && e.name.toLowerCase()===name.toLowerCase())) return toast('Exercise already exists');
  if (!commitRoutineData(()=>{const e=eid ? exById(eid) : null;if(e)Object.assign(e,{name,category,muscle});else data.exercises.push({id:id(),name,category,muscle});})) return;
  closeModal();render();toast('Exercise saved');
}
saveNewExercise = function() { saveLibraryExercise(null); };
function removeLibraryExercise(eid) {
  const e=exById(eid);if(!e)return;
  if(!confirm('Remove '+e.name+' from your library and saved templates? Workout history and the current session will be kept. You can restore this exercise later.'))return;
  if(!commitRoutineData(()=>{e.archived=true;for(const t of data.templates){t.exercises=t.exercises.filter(x=>x.exerciseId!==eid);if(!t.exercises.length)t.isDefault=false;}}))return;
  render();toast('Exercise removed; history retained');
}
function showRemovedExercises() {
  modal(`<h2>Removed exercises</h2><p>Restore exercises to your library. Add restored exercises back to any templates you want to use.</p><div class="stack" style="margin-top:16px">${data.exercises.filter(e=>e.archived).map(e=>`<div class="routine-list-row"><span>${esc(e.name)}</span>${button('Restore',`restoreLibraryExercise(${jsArg(e.id)})`,'small')}</div>`).join('') || '<div class="empty">No removed exercises.</div>'}</div>`);
}
function restoreLibraryExercise(eid) {
  if(!commitRoutineData(()=>{const e=exById(eid);if(e)e.archived=false;}))return;
  closeModal();render();toast('Exercise restored');
}
let routineEditor=null;
function editRoutine(tid=null,category=null,source=null) {
  const t=data.templates.find(t=>t.id===tid);
  const from=source==='draft' ? draft : t;
  category=category || from?.category || data.categories[0] || 'PUSH';
  routineEditor={id:t?.id || null,name:t?.name || category+' routine',category,isDefault:t ? !!t.isDefault : true,exercises:availableRoutineExercises(from).map(e=>({exerciseId:e.exerciseId,sets:clone(e.sets?.length?e.sets:[blankRoutineSet()])}))};
  modal(`<h2>${t?'Edit':'Build'} template</h2><p>Choose exercises in the order you want to train. The default template loads when you start its split.</p><div class="stack" style="margin-top:16px"><label class="field">Template name<input class="input" id="routineName" value="${esc(routineEditor.name)}" oninput="routineEditor.name=this.value"></label><label class="field">Training split<select id="routineCategory" onchange="routineEditor.category=this.value">${data.categories.map(c=>`<option ${c===category?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label class="routine-check"><input type="checkbox" id="routineDefault" ${routineEditor.isDefault?'checked':''} onchange="routineEditor.isDefault=this.checked"><span>Load automatically when starting this split</span></label><h3>Choose exercises</h3><input class="input" aria-label="Find exercises for template" placeholder="Find an exercise..." oninput="document.querySelectorAll('.routine-pick').forEach(e=>e.hidden=!e.textContent.toLowerCase().includes(this.value.toLowerCase()))"><div class="routine-picker">${activeExercises().map(e=>`<label class="routine-check routine-pick"><input type="checkbox" ${routineEditor.exercises.some(x=>x.exerciseId===e.id)?'checked':''} onchange="${esc(`chooseRoutineExercise(${jsArg(e.id)},this.checked)`)}"><span>${esc(e.name)} <span class="muted tiny">${esc(e.category)}</span></span></label>`).join('') || '<p>Add exercises to your library first.</p>'}</div><h3>Order & sets</h3><div id="routineSelection" class="stack"></div>${button('Save template','saveRoutineEditor()','primary wide')}</div>`);
  renderRoutineSelection();
}
function chooseRoutineExercise(eid,checked) {
  if(!routineEditor)return;
  if(checked && !routineEditor.exercises.some(e=>e.exerciseId===eid))routineEditor.exercises.push({exerciseId:eid,sets:Array.from({length:3},blankRoutineSet)});
  if(!checked)routineEditor.exercises=routineEditor.exercises.filter(e=>e.exerciseId!==eid);
  renderRoutineSelection();
}
function renderRoutineSelection() {
  const root=document.getElementById('routineSelection');if(!root||!routineEditor)return;
  root.innerHTML=routineEditor.exercises.map((e,i)=>`<div class="routine-selected"><strong>${i+1}. ${esc(exById(e.exerciseId)?.name || 'Exercise')}</strong><div class="routine-selected-controls"><label class="field">Sets<input class="input" type="number" min="1" max="20" step="1" value="${e.sets.length}" aria-label="Sets for ${esc(exById(e.exerciseId)?.name)}" onchange="setRoutineSetCount(${i},this.value)"></label><div class="actions"><button type="button" class="btn small" aria-label="Move exercise ${i+1} up" onclick="moveRoutineExercise(${i},-1)" ${i===0?'disabled':''}>↑</button><button type="button" class="btn small" aria-label="Move exercise ${i+1} down" onclick="moveRoutineExercise(${i},1)" ${i===routineEditor.exercises.length-1?'disabled':''}>↓</button></div></div></div>`).join('') || '<p>No exercises selected yet.</p>';
}
function setRoutineSetCount(i,value) {
  const count=Number(value);if(!Number.isInteger(count)||count<1||count>20){toast('Choose 1 to 20 sets');renderRoutineSelection();return;}
  const e=routineEditor.exercises[i];e.sets=Array.from({length:count},(_,j)=>e.sets[j] || blankRoutineSet());
}
function moveRoutineExercise(i,direction) {
  const j=i+direction;if(j<0||j>=routineEditor.exercises.length)return;
  [routineEditor.exercises[i],routineEditor.exercises[j]]=[routineEditor.exercises[j],routineEditor.exercises[i]];renderRoutineSelection();
}
function saveRoutineEditor() {
  if(!routineEditor)return;
  // Read controls too: includes values changed without blurring the field.
  routineEditor.name=document.getElementById('routineName').value.trim();
  routineEditor.category=document.getElementById('routineCategory').value;
  routineEditor.isDefault=document.getElementById('routineDefault').checked;
  const counts=[...document.querySelectorAll('#routineSelection input')].map(e=>Number(e.value));
  if(!routineEditor.name)return toast('Enter a template name');
  if(!routineEditor.exercises.length)return toast('Choose at least one exercise');
  if(counts.some(n=>!Number.isInteger(n)||n<1||n>20))return toast('Choose 1 to 20 sets per exercise');
  counts.forEach((count,i)=>setRoutineSetCount(i,count));
  const saved=clone(routineEditor);saved.id ||= id();
  if(!commitRoutineData(()=>{if(saved.isDefault)data.templates.forEach(t=>{if(t.category===saved.category)t.isDefault=false;});const at=data.templates.findIndex(t=>t.id===saved.id);if(at<0)data.templates.push(saved);else data.templates[at]=saved;}))return;
  routineEditor=null;closeModal();render();toast('Template saved'+(saved.isDefault?' · ready for '+saved.category:''));
}
templatesHTML = function() {
  return data.templates.length ? data.templates.map(t=>`<div class="historyitem routine-template"><div><b>${esc(t.name)}</b><div class="muted tiny">${esc(t.category)} · ${availableRoutineExercises(t).length} exercises${t.isDefault?' · AUTOLOAD':''}</div></div><div class="actions">${button('Use template',`useTemplate(${jsArg(t.id)})`,'small primary')}${button('Edit',`editRoutine(${jsArg(t.id)})`,'small')}${button('Delete',`deleteRoutine(${jsArg(t.id)})`,'small danger')}</div></div>`).join('') : '<div class="empty">No templates yet. Build one from your library or save your ongoing workout.</div>';
};
showTemplates = function() {
  modal(`<h2>Workout templates</h2><p>Set one automatic template per split using Edit.</p><div style="margin:16px 0">${button('＋ Build template','editRoutine()','primary')}</div><div class="stack">${templatesHTML()}</div>`);
};
useTemplate = function(tid) {
  const t=data.templates.find(t=>t.id===tid);if(!t)return;
  const exercises=routineSessionExercises(t);if(!exercises.length)return toast('This template has no available exercises. Edit it first.');
  if(draft&&!confirm('Replace the current draft?'))return;
  draft={id:id(),category:t.category,date:date(),notes:'',exercises};saveDraft();closeModal();navigate('workout');
};
function deleteRoutine(tid) {
  if(!confirm('Delete this template? Saved workouts and your current session will be kept.'))return;
  if(!commitRoutineData(()=>data.templates=data.templates.filter(t=>t.id!==tid)))return;
  render();showTemplates();
}
saveTemplate = function(wid) {
  const w=data.workouts.find(w=>w.id===wid);if(!w)return;
  editRoutine(null,w.category);
  routineEditor.exercises=availableRoutineExercises(w).map(e=>({exerciseId:e.exerciseId,sets:clone(e.sets)}));
  document.querySelectorAll('.routine-pick input').forEach((input,i)=>input.checked=routineEditor.exercises.some(e=>e.exerciseId===activeExercises()[i]?.id));
  renderRoutineSelection();
};
const baseIsDefaultData=window.IronlogBridge.isDefaultData;
window.IronlogBridge.isDefaultData=value=>!value?.exercises?.some(e=>e.archived) && baseIsDefaultData(value);
render();

