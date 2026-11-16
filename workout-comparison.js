'use strict';
let comparisonSelection={category:null,current:null,previous:null};
function comparableSets(exercise){return (exercise?.sets || []).filter(s=>!s.warmup&&s.weight!==''&&s.weight!=null&&s.reps!==''&&s.reps!=null&&Number.isFinite(Number(s.weight))&&Number(s.weight)>=0&&Number.isFinite(Number(s.reps))&&Number(s.reps)>0);}
function comparisonMetrics(exercises){
  const sets=exercises.flatMap(comparableSets),top=sets.length?Math.max(...sets.map(s=>Number(s.weight))):null;
  return {sets:effectiveSetCount(sets),reps:sets.reduce((a,s)=>a+Number(s.reps)*setMultiplier(s),0),volume:sets.reduce((a,s)=>a+Number(s.weight)*Number(s.reps)*setMultiplier(s),0),top,topReps:top===null?null:Math.max(...sets.filter(s=>Number(s.weight)===top).map(s=>Number(s.reps)))};
}
function splitSessions(category){return data.workouts.filter(w=>w.category===category).sort((a,b)=>a.date.localeCompare(b.date)||(Number(a.savedAt)||0)-(Number(b.savedAt)||0)||a.id.localeCompare(b.id));}
function comparisonDelta(current,previous,unit){if(current==null||previous==null)return 'No matching baseline';const difference=current-previous;return (difference>0?'+':'')+fmt(difference)+' '+unit;}
function comparisonWorkoutLabel(w){return dateFmt(w.date)+(w.savedAt?' · '+new Date(w.savedAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}):'')+' · '+w.exercises.length+' exercises';}
function comparisonExerciseCell(exercises,label){
  if(!exercises.length)return `<div class="comparison-cell"><b>${esc(label)}</b><p>Not in this session</p></div>`;
  const m=comparisonMetrics(exercises);
  return `<div class="comparison-cell"><b>${esc(label)}</b><strong>${m.top===null?'No working sets':fmt(m.top)+' kg × '+fmt(m.topReps)}</strong><p class="tiny">Top weight × reps at that weight</p><p>${m.sets} sets · ${fmt(m.reps)} reps</p><p>${fmt(m.volume)} kg volume</p><div class="tiny muted comparison-set-list">${exercises.flatMap(comparableSets).map(s=>esc(fmt(Number(s.weight))+' kg × '+fmt(Number(s.reps))+(s.eachSide?' each side':''))).join(' · ')}</div></div>`;
}
function comparisonBars(oldValue,newValue){
  const max=Math.max(oldValue??0,newValue??0,1);
  return `<div class="comparison-bars" role="img" aria-label="Top weight comparison: earlier ${oldValue===null?'no working sets':oldValue+' kilograms'}, selected ${newValue===null?'no working sets':newValue+' kilograms'}">${[['Earlier',oldValue,'previous'],['Selected',newValue,'current']].map(([label,value,cls])=>`<div><span class="tiny">${label}: ${value===null?'—':fmt(value)+' kg'}</span><div class="comparison-track"><div class="comparison-bar ${cls}" style="width:${value===null?0:Math.max(0,value)/max*100}%"></div></div></div>`).join('')}</div>`;
}
function updateWorkoutComparison(field,value){comparisonSelection[field]=value;if(field==='category'){comparisonSelection.current=null;comparisonSelection.previous=null;}if(field==='current')comparisonSelection.previous=null;renderWorkoutComparison();}
function renderWorkoutComparison(){
  const root=document.getElementById('workout-comparison');if(!root)return;
  const categories=[...new Set([...data.categories,...data.workouts.map(w=>w.category)])];
  if(!categories.includes(comparisonSelection.category))comparisonSelection.category=categories.find(c=>splitSessions(c).length)||categories[0];
  const sessions=splitSessions(comparisonSelection.category);
  const current=sessions.find(w=>w.id===comparisonSelection.current)||sessions.at(-1);
  comparisonSelection.current=current?.id||null;
  const earlier=current?sessions.slice(0,sessions.findIndex(w=>w.id===current.id)):[];
  const previous=earlier.find(w=>w.id===comparisonSelection.previous)||earlier.at(-1);
  comparisonSelection.previous=previous?.id||null;
  root.innerHTML=`<div class="sectionhead"><h2>Compare workouts by split</h2></div><p>Compare saved sessions of the same split. Warm-ups and incomplete sets are excluded.</p><div class="grid cols3 comparison-filters"><label class="field">Training split<select id="compareSplit" onchange="updateWorkoutComparison('category',this.value)">${categories.map(c=>`<option ${c===comparisonSelection.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label class="field">Selected workout<select id="compareCurrent" onchange="updateWorkoutComparison('current',this.value)" ${sessions.length?'':'disabled'}>${[...sessions].reverse().map(w=>`<option value="${esc(w.id)}" ${w.id===current?.id?'selected':''}>${esc(comparisonWorkoutLabel(w))}</option>`).join('')||'<option>No saved workouts</option>'}</select></label><label class="field">Earlier workout<select id="comparePrevious" onchange="updateWorkoutComparison('previous',this.value)" ${earlier.length?'':'disabled'}>${[...earlier].reverse().map(w=>`<option value="${esc(w.id)}" ${w.id===previous?.id?'selected':''}>${esc(comparisonWorkoutLabel(w))}</option>`).join('')||'<option>No earlier workout</option>'}</select></label></div><div id="comparison-results"></div>`;
  const results=root.querySelector('#comparison-results');
  if(!current){results.innerHTML='<div class="empty">Save a workout in this split to start tracking progression.</div>';return;}
  const trend=`<div class="panel comparison-trend"><h3>${esc(comparisonSelection.category)} session volume over time</h3>${lineChart(sessions.map(w=>({label:dateFmt(w.date),val:comparisonMetrics(w.exercises).volume})),'kg')}<p class="tiny">Total working-set weight × reps. Volume changes with exercise choice and set count; compare matching exercises below.</p></div>`;
  if(!previous){results.innerHTML='<div class="empty">Save another workout in this split to compare two sessions.</div>'+trend;return;}
  const oldMetrics=comparisonMetrics(previous.exercises),newMetrics=comparisonMetrics(current.exercises);
  const metric=(title,oldValue,newValue,unit)=>`<div class="panel"><h3>${title}</h3><div class="comparison-pair"><div><span class="muted tiny">Earlier</span><strong>${fmt(oldValue)} ${unit}</strong></div><div><span class="muted tiny">Selected</span><strong>${fmt(newValue)} ${unit}</strong></div></div><p class="accent">${esc(comparisonDelta(newValue,oldValue,unit))}</p></div>`;
  const ids=[...new Set([...current.exercises,...previous.exercises].map(e=>e.exerciseId))];
  results.innerHTML=`<div class="grid cols3 comparison-totals">${metric('Working-set volume',oldMetrics.volume,newMetrics.volume,'kg')}${metric('Working sets',oldMetrics.sets,newMetrics.sets,'sets')}${metric('Total repetitions',oldMetrics.reps,newMetrics.reps,'reps')}</div><p class="settingsnote">Earlier: ${esc(comparisonWorkoutLabel(previous))}. Selected: ${esc(comparisonWorkoutLabel(current))}. Different exercise lists can change total volume without indicating a strength gain.</p><div class="stack comparison-exercises">${ids.map(eid=>{
    const oldEx=previous.exercises.filter(e=>e.exerciseId===eid),newEx=current.exercises.filter(e=>e.exerciseId===eid),oldM=comparisonMetrics(oldEx),newM=comparisonMetrics(newEx);
    return `<article class="panel comparison-exercise"><h3>${esc(exById(eid)?.name||'Exercise no longer in library')}</h3><div class="comparison-pair">${comparisonExerciseCell(oldEx,'Earlier')}${comparisonExerciseCell(newEx,'Selected')}</div><div class="comparison-changes"><p>Top weight: <b>${esc(comparisonDelta(newM.top,oldM.top,'kg'))}</b></p><p>Volume: <b>${esc(oldEx.length&&newEx.length?comparisonDelta(newM.volume,oldM.volume,'kg'):'No matching baseline')}</b></p></div>${comparisonBars(oldM.top,newM.top)}</article>`;
  }).join('')}</div>${trend}`;
}
const beforeComparisonAnalytics=renderAnalytics;
renderAnalytics=function(){beforeComparisonAnalytics();const root=document.createElement('section');root.id='workout-comparison';root.className='comparison-section';document.getElementById('analytics').querySelector('.subline').after(root);renderWorkoutComparison();};
const beforeComparisonAccount=window.IronlogBridge.switchAccount;
window.IronlogBridge.switchAccount=function(uid){comparisonSelection={category:null,current:null,previous:null};return beforeComparisonAccount(uid);};
if(current==='analytics')renderAnalytics();
