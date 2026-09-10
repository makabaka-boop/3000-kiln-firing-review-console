import type {AnomalyStatus,Batch,Recipe,Review,Sample,Store} from './types';
export const STORE_KEY='kiln-review-console-v1';
export type CompareNode={minute:number;current:number;reference:number;diff:number};
export type CompareResult={kind:'ok';nodes:CompareNode[];maxDiff:number;maxMinute:number;avgDiff:number}|{kind:'error';reason:string};
export const validPoints=(b:Batch)=>{const pts=b.samples.map(p=>({minute:(Date.parse(p.time)-Date.parse(b.start))/60000,temperature:p.temperature})).filter(p=>Number.isFinite(p.minute)&&Number.isFinite(p.temperature)).sort((a,b)=>a.minute-b.minute);return pts.filter((p,i)=>i===0||p.minute!==pts[i-1].minute)};
function interp(points:{minute:number;temperature:number}[],m:number){if(m<=points[0].minute)return points[0].temperature;for(let i=1;i<points.length;i++){if(m<=points[i].minute){const a=points[i-1],z=points[i],span=z.minute-a.minute||1;return a.temperature+(z.temperature-a.temperature)*((m-a.minute)/span)}}return points[points.length-1].temperature}
export function compareCurves(current:Batch,reference:Batch):CompareResult{const cp=validPoints(current),rp=validPoints(reference);if(rp.length<2)return {kind:'error',reason:'参考批次有效采样点不足 2 个，无法生成曲线对比'};if(cp.length<2)return {kind:'error',reason:'当前批次有效采样点不足 2 个，无法生成曲线对比'};const lo=Math.max(cp[0].minute,rp[0].minute),hi=Math.min(cp[cp.length-1].minute,rp[rp.length-1].minute);const first=(()=>{const c=Math.ceil(lo);return Math.abs(c-1-lo)<1e-9?c-1:c})();
const last=(()=>{const f=Math.floor(hi);return Math.abs(f+1-hi)<1e-9?f+1:f})();if(first>last)return {kind:'error',reason:'两条曲线的采样时间区间没有共同覆盖区间，无法逐分钟对比'};const nodes:CompareNode[]=[];for(let m=first;m<=last;m++){const cv=interp(cp,m),rv=interp(rp,m);nodes.push({minute:m,current:cv,reference:rv,diff:Math.abs(cv-rv)})}const maxRaw=nodes.reduce((z,n)=>Math.max(z,n.diff),-Infinity);const avgRaw=nodes.reduce((z,n)=>z+n.diff,0)/nodes.length;return {kind:'ok',nodes,maxDiff:Math.round(maxRaw*10)/10,maxMinute:nodes.find(n=>n.diff===maxRaw)!.minute,avgDiff:Math.round(avgRaw*10)/10}}
export const compareCandidates=(store:Store,batch:Batch)=>store.batches.filter(b=>b.id!==batch.id&&b.recipeId===batch.recipeId&&Date.parse(b.start)<Date.parse(batch.start)&&validPoints(b).length>=2);
export const referenceStatus=(store:Store,batch:Batch):{ref?:Batch;reason?:string}=>{const id=batch.referenceBatchId;if(!id)return {};const ref=store.batches.find(b=>b.id===id);if(!ref)return {reason:'所选参考批次已被删除，请改选其他批次或清除对比。'};if(ref.id===batch.id)return {ref,reason:'参考批次不能是当前批次自身，该引用已不可用。'};if(ref.recipeId!==batch.recipeId)return {ref,reason:'参考批次与当前批次的配方已不一致，该参考批次已不再可用。'};return {ref}};
export const initialStore:Store={version:1,gapMinutes:45,recipes:[{id:'r1',name:'青瓷还原烧',target:1280,tolerance:15,duration:720},{id:'r2',name:'素烧',target:900,tolerance:20,duration:480}],batches:[{id:'b1',name:'九月青瓷 A 批',kiln:'K-02',recipeId:'r1',start:'2026-09-08T08:30',notes:'窑位较满，重点关注升温末段。',samples:[{time:'2026-09-08T08:30',temperature:26},{time:'2026-09-08T10:00',temperature:310},{time:'2026-09-08T12:00',temperature:690},{time:'2026-09-08T15:00',temperature:1110},{time:'2026-09-08T18:00',temperature:1262},{time:'2026-09-08T20:30',temperature:1287}],reviews:{}}]};
export const uid=()=>Math.random().toString(36).slice(2,10);
const REVIEW_STATUSES:AnomalyStatus[]=['pending','equipment','process','accepted'];
// 复核记录必须是非空对象且每条状态为已知值：记录为空会让统计页崩溃，未知状态会让异常从待复核中消失，此类备份整份拒绝
const reviewsOk=(r:unknown)=>!!r&&typeof r==='object'&&!Array.isArray(r)&&Object.values(r).every(v=>!!v&&typeof v==='object'&&REVIEW_STATUSES.includes((v as Review).status)&&typeof (v as Review).note==='string');
// 采样时间必须按升序排列（允许同一时刻重复）：逆序备份的正向超限间隔会被漏判，整份拒绝
const samplesOrdered=(samples:Sample[])=>samples.every((p,i)=>{if(!i)return true;const prev=Date.parse(samples[i-1].time),cur=Date.parse(p.time);return!Number.isFinite(prev)||!Number.isFinite(cur)||cur>=prev});
// 统一间隔若以数字给出，必须是不小于 1 的安全整数：0 或负数会把所有正向间隔误判为异常，整份拒绝（null/缺失等非数字仍由 sanitizeStore 修复）
const gapOk=(g:unknown)=>typeof g!=='number'||!Number.isSafeInteger(g)||g>=1;
export function isStore(x:unknown):x is Store{if(!x||typeof x!=='object')return false;const s=x as Store;const batchOk=(b:Batch)=>typeof b.id==='string'&&typeof b.name==='string'&&typeof b.kiln==='string'&&typeof b.recipeId==='string'&&Array.isArray(b.samples)&&b.samples.every(p=>typeof p.time==='string'&&typeof p.temperature==='number')&&samplesOrdered(b.samples)&&reviewsOk(b.reviews);return s.version===1&&gapOk(s.gapMinutes)&&Array.isArray(s.recipes)&&Array.isArray(s.batches)&&s.recipes.every(r=>typeof r.id==='string'&&typeof r.name==='string'&&typeof r.target==='number'&&typeof r.tolerance==='number'&&typeof r.duration==='number')&&s.batches.every(batchOk)}
export type CsvRow={line:number;time:string;temperature:number};
const pad=(v:number)=>String(v).padStart(2,'0');
const wallTime=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minuteStamp=(v:string)=>{const t=Date.parse(v);return Number.isFinite(t)?Date.parse(wallTime(new Date(t))):NaN};
export function parseCsvRows(raw:string):{errors:string[];rows:CsvRow[]}{const lines=raw.trim().split(/\r?\n/);const errors:string[]=[];if(lines.length<2)return {errors:['CSV 至少需要表头和一行数据'],rows:[]};const head=lines[0].split(',').map(x=>x.trim());if(head.length!==2||head[0]!=='时间'||head[1]!=='温度')return {errors:['第 1 行：表头必须为“时间,温度”'],rows:[]};const seen=new Set<number>();let last=-Infinity;const rows=[] as CsvRow[];for(let i=1;i<lines.length;i++){const cells=lines[i].split(',').map(x=>x.trim());if(cells.length!==2){errors.push(`第 ${i+1} 行：应有 2 列`);continue}const stamp=Date.parse(cells[0]);const temp=Number(cells[1]);if(!cells[0]||Number.isNaN(stamp))errors.push(`第 ${i+1} 行：时间格式无效`);if(cells[1]===''||!Number.isFinite(temp))errors.push(`第 ${i+1} 行：温度必须是数字`);if(Number.isFinite(stamp)){const norm=Date.parse(wallTime(new Date(stamp)));if(seen.has(norm))errors.push(`第 ${i+1} 行：时间点重复`);if(stamp<last)errors.push(`第 ${i+1} 行：时间早于上一行`);seen.add(norm);last=stamp}if(Number.isFinite(stamp)&&Number.isFinite(temp))rows.push({line:i+1,time:wallTime(new Date(stamp)),temperature:temp})}return {errors,rows:errors.length?[]:rows}}
export function parseCsv(raw:string){const r=parseCsvRows(raw);return {errors:r.errors,samples:r.rows.map(({time,temperature})=>({time,temperature}))}}
export function mergeCsvRows(rows:CsvRow[],existing:Sample[]):{errors:string[];samples:Sample[]}{const taken=new Set(existing.map(p=>minuteStamp(p.time)).filter(Number.isFinite));for(const row of rows){if(taken.has(Date.parse(row.time)))return {errors:[`第 ${row.line} 行：时间点 ${row.time.replace('T',' ')} 已存在于当前批次`],samples:[]}}const samples=[...existing,...rows.map(({time,temperature})=>({time,temperature}))].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));return {errors:[],samples}}
export function appendCsv(raw:string,existing:Sample[]):{errors:string[];samples:Sample[]}{const {errors,rows}=parseCsvRows(raw);if(errors.length)return {errors,samples:[]};return mergeCsvRows(rows,existing)}
export type GapSource={value:number;source:'batch'|'global'};
// 异常判定统一入口：批次有合法自定义值时用自定义值，否则回退工作台统一值
export function resolveGapMinutes(batch:Batch,globalGap:number):GapSource{const v=batch.gapMinutesOverride;return typeof v==='number'&&Number.isSafeInteger(v)&&v>=1?{value:v,source:'batch'}:{value:globalGap,source:'global'}}
// 自定义值必须是不小于 1 的安全整数；为空、非整数、小于 1 或超出安全整数范围（如超长数字串会变成 Infinity）均拒绝
export function parseGapOverride(raw:string):{ok:true;value:number}|{ok:false;reason:string}{const t=raw.trim();if(t==='')return {ok:false,reason:'请输入分钟数后再保存'};if(!/^\d+$/.test(t))return {ok:false,reason:'最大采样间隔必须是整数分钟'};const v=Number(t);if(v<1)return {ok:false,reason:'最大采样间隔不能小于 1 分钟'};if(!Number.isSafeInteger(v))return {ok:false,reason:'分钟数过大，请输入不超过 9007199254740991 的整数'};return {ok:true,value:v}}
// 清洗存档中的异常间隔字段（历史版本可能把 Infinity 序列化成 null）：非法覆盖值删除后按统一值处理，不影响其他数据
export function sanitizeStore(x:Store):Store{x.batches.forEach(b=>{const v=b.gapMinutesOverride as unknown;if(v!==undefined&&!(typeof v==='number'&&Number.isSafeInteger(v as number)&&(v as number)>=1))delete b.gapMinutesOverride});if(!Number.isFinite(x.gapMinutes)||!Number.isSafeInteger(x.gapMinutes))x.gapMinutes=45;return x}
export function anomalies(batch:Batch,target:number,tolerance:number,gapMinutes:number){const out:{key:string;time:string;value:string;reason:string}[]=[];batch.samples.forEach((p,i)=>{if(Math.abs(p.temperature-target)>tolerance)out.push({key:`range-${p.time}`,time:p.time,value:`${p.temperature} °C`,reason:`超出 ${target} ± ${tolerance} °C`});if(i){const gap=(Date.parse(p.time)-Date.parse(batch.samples[i-1].time))/60000;if(gap>gapMinutes)out.push({key:`gap-${p.time}`,time:p.time,value:`${Math.round(gap)} 分钟`,reason:`采样间隔超过 ${gapMinutes} 分钟`})}});return out}
export type ScheduleDraft={id?:string;kiln:string;recipeId:string;start:string};
export type Occupancy={batchId:string;name:string;startMs:number;endMs:number};
export type ScheduleConflict={current:Occupancy;other:Occupancy;overlapStartMs:number;overlapMinutes:number};
const positiveDuration=(recipe:Recipe|undefined)=>!!recipe&&Number.isFinite(recipe.duration)&&recipe.duration>0;
function batchOccupancy(b:Batch,recipes:Recipe[]):Occupancy|null{
  const recipe=recipes.find(r=>r.id===b.recipeId);
  const startMs=Date.parse(b.start);
  if(!b.kiln||!Number.isFinite(startMs)||!positiveDuration(recipe))return null;
  return {batchId:b.id,name:b.name,startMs,endMs:startMs+recipe!.duration*60000};
}
function pairConflict(current:Occupancy,other:Occupancy):ScheduleConflict|null{
  const overlapStartMs=Math.max(current.startMs,other.startMs),overlapEndMs=Math.min(current.endMs,other.endMs);
  return overlapStartMs<overlapEndMs?{current,other,overlapStartMs,overlapMinutes:Math.round((overlapEndMs-overlapStartMs)/60000)}:null;
}
const compareBatchId=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
const conflictOrder=(c:ScheduleConflict):[number,string,string]=>[c.overlapStartMs,c.current.batchId,c.other.batchId];
// 窑炉占用按左闭右开比较：endA===startB 属于首尾相接，可以连续生产；只有 max(start)<min(end) 才是真重叠。
export function findScheduleConflicts(recipes:Recipe[],batches:Batch[],draft?:ScheduleDraft):ScheduleConflict[]{
  const kilnOf=new Map(batches.map(b=>[b.id,b.kiln]));
  const occupied=batches.map(b=>({b,o:batchOccupancy(b,recipes)})).filter((x):x is {b:Batch;o:Occupancy}=>!!x.o&&(!draft?.id||x.b.id!==draft.id));
  const out:ScheduleConflict[]=[];
  const draftRecipe=draft?recipes.find(r=>r.id===draft.recipeId):undefined;
  const draftStart=draft?Date.parse(draft.start):NaN;
  const draftO:Occupancy|null=draft&&draft.kiln&&Number.isFinite(draftStart)&&positiveDuration(draftRecipe)
    ?{batchId:draft.id||'',name:'当前表单',startMs:draftStart,endMs:draftStart+draftRecipe!.duration*60000}:null;
  if(draft&&draftO){
    occupied.forEach(({o})=>{if((kilnOf.get(o.batchId)||'').trim()===draft.kiln.trim()){const c=pairConflict(draftO,o);if(c)out.push(c)}});
  }else{
    occupied.forEach(({o:a},i)=>occupied.slice(i+1).forEach(({o:b})=>{if((kilnOf.get(a.batchId)||'').trim()===(kilnOf.get(b.batchId)||'').trim()){const ab=pairConflict(a,b),ba=ab&&{...ab,current:ab.other,other:ab.current};if(ab&&ba)out.push(ab,ba)}}));
  }
  // 稳定排序：重叠起点优先，起点相同时按双方批次编号确定顺序。
  return out.sort((a,b)=>{const x=conflictOrder(a),y=conflictOrder(b);return x[0]-y[0]||compareBatchId(x[1],y[1])||compareBatchId(x[2],y[2])});
}
export const firstScheduleConflict=(recipes:Recipe[],batches:Batch[],draft:ScheduleDraft)=>findScheduleConflicts(recipes,batches,draft)[0]||null;
export const conflictingBatchIds=(recipes:Recipe[],batches:Batch[])=>new Set(findScheduleConflicts(recipes,batches).flatMap(c=>[c.current.batchId,c.other.batchId]));
const pad2=(v:number)=>String(v).padStart(2,'0');
export const formatScheduleTime=(ms:number)=>{const d=new Date(ms);return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`};
