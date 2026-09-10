import {afterEach,describe,expect,it} from 'vitest';
import {compareCurves,compareCandidates,parseCsv,validPoints} from './data';
import type {Batch,Sample,Store} from './types';

function wallStamp(start:string,min:number){const d=new Date(Date.parse(start)+min*60000);const p=(v:number)=>String(v).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`}
function mkBatch(id:string,start:string,samples:Array<[number,number]>,recipeId='r1'):Batch{
  const s:Sample[]=samples.map(([min,temp])=>({time:wallStamp(start,min),temperature:temp}));
  return {id,name:id,kiln:'K1',recipeId,start,notes:'',samples:s,reviews:{}};
}
// 固定样本：两条曲线均为不等间隔采样
// 当前：0,4,10,20 分钟；参考：0,3,10,15,20 分钟
const start='2026-09-01T08:00';
const current=mkBatch('cur',start,[[0,100],[4,104],[10,110],[20,120]]);
const reference=mkBatch('ref',start,[[0,100],[3,109],[10,150],[15,175],[20,200]]);

describe('历史曲线对比算法',()=>{
  it('只在采样区间交集内逐整数分钟插值（不等间隔）',()=>{
    const r=compareCurves(current,reference);
    expect(r.kind).toBe('ok');
    if(r.kind!=='ok')return;
    // 交集 [0,20]，整数节点 0..20 共 21 个
    expect(r.nodes.map(n=>n.minute)).toEqual(Array.from({length:21},(_,i)=>i));
    // 当前批次：[0,4] 每分钟 +1；[4,10] 每分钟 +1；[10,20] 每分钟 +1
    expect(r.nodes.map(n=>n.current)).toEqual(Array.from({length:21},(_,i)=>100+i));
    // 参考批次不等间隔分段：0-3 每分钟 +3，3-10 每分钟 +41/7，10-15 每分钟 +5，15-20 每分钟 +5
    expect(r.nodes[0].reference).toBe(100);
    expect(r.nodes[2].reference).toBeCloseTo(106,6);
    expect(r.nodes[3].reference).toBe(109);
    expect(r.nodes[4].reference).toBeCloseTo(109+41/7,6);
    expect(r.nodes[9].reference).toBeCloseTo(109+41*6/7,6);
    expect(r.nodes[10].reference).toBe(150);
    expect(r.nodes[15].reference).toBe(175);
    expect(r.nodes[20].reference).toBe(200);
  });
  it('统计绝对温差最大值与平均值（一位小数），并列取最早节点',()=>{
    const r=compareCurves(current,reference);
    if(r.kind!=='ok')throw new Error('expected ok');
    const diffs=r.nodes.map(n=>n.diff);
    // 参考 - 当前：m0=0,m1=2,m2=4,m3=6,m4≈2.857...,m10=40,m15=60,m20=80
    expect(diffs[0]).toBe(0);
    expect(diffs[3]).toBe(6);
    expect(diffs[10]).toBe(40);
    expect(diffs[20]).toBe(80);
    expect(r.maxDiff).toBe(80);
    expect(r.maxMinute).toBe(20);
    const avg=diffs.reduce((a,b)=>a+b,0)/21;
    expect(r.avgDiff).toBe(Math.round(avg*10)/10);
    expect(r.avgDiff).toBeCloseTo(avg,1);
  });
  it('最大温差并列时取最早发生节点，数值保留一位小数',()=>{
    // 当前恒为 100；参考在 4 分钟和 10 分钟都比当前高 40（并列最大）
    const c=mkBatch('c','2026-01-01T00:00',[[0,100],[4,100],[10,100],[12,100]]);
    const r=mkBatch('r','2026-02-02T05:30',[[0,100],[4,140],[10,140],[12,100]]);
    const out=compareCurves(c,r);
    if(out.kind!=='ok')throw new Error('expected ok');
    expect(out.maxDiff).toBe(40);
    expect(out.maxMinute).toBe(4);
    // m0=0,m1=10,m2=20,m3=30,m4..10=40,m11=20,m12=0，共 360/13
    const expectedAvg=Math.round((360/13)*10)/10;
    expect(out.avgDiff).toBe(expectedAvg);
    expect(out.avgDiff.toFixed(1)).toBe('27.7');
    expect(out.nodes.map(n=>n.minute)).toEqual(Array.from({length:13},(_,i)=>i));
  });
  it('两条曲线按各自开始时间计算经过分钟',()=>{
    // 同一绝对时刻 09:00，对当前是 60 分钟，对参考是 30 分钟
    const c=mkBatch('c','2026-09-01T08:00',[[0,0],[60,10],[120,20]]);
    const r=mkBatch('r','2026-09-05T08:30',[[0,5],[30,15],[120,30]]);
    const out=compareCurves(c,r);
    if(out.kind!=='ok')throw new Error('expected ok');
    // 交集为经过分钟 [max(0,0), min(120,120)] = [0,120]
    expect(out.nodes).toHaveLength(121);
    // m30：参考采样点 15；当前插值 0+(20-0)/120*30=5
    expect(out.nodes[30].reference).toBe(15);
    expect(out.nodes[30].current).toBeCloseTo(5,10);
    // m60：当前采样点 10；参考插值 15+(30-15)/(120-30)*30=20
    expect(out.nodes[60].current).toBe(10);
    expect(out.nodes[60].reference).toBeCloseTo(20,10);
  });
  it('交集边界不是整数时取内部整数节点',()=>{
    const c=mkBatch('c','2026-01-01T00:00',[[1,0],[10,0]]);
    const r=mkBatch('r','2026-01-01T00:00',[[0,80],[5,80],[12,80]]);
    const out=compareCurves(c,r);
    if(out.kind!=='ok')throw new Error('expected ok');
    // 交集 [max(1,0), min(10,12)] = [1,10]
    expect(out.nodes.map(n=>n.minute)).toEqual(Array.from({length:10},(_,i)=>i+1));
    expect(out.maxDiff).toBe(80);
    expect(out.maxMinute).toBe(1);
    expect(out.avgDiff).toBe(80);
  });
  it('参考批次采样不足 2 点时报错',()=>{
    const r=compareCurves(current,mkBatch('few',start,[[0,100]]));
    expect(r).toEqual({kind:'error',reason:expect.stringContaining('参考批次有效采样点不足')});
  });
  it('当前批次采样不足 2 点时报错',()=>{
    const c=mkBatch('few','2026-01-01T00:00',[[0,100]]);
    const r=compareCurves(c,mkBatch('ref',start,[[0,100],[5,120]]));
    expect(r).toEqual({kind:'error',reason:expect.stringContaining('当前批次有效采样点不足')});
  });
  it('采样区间无共同覆盖时报错',()=>{
    const c=mkBatch('c','2026-01-01T00:00',[[0,100],[10,110]]);
    const r=mkBatch('r','2026-01-01T00:00',[[20,100],[30,120]]);
    const out=compareCurves(c,r);
    expect(out).toEqual({kind:'error',reason:expect.stringContaining('没有共同覆盖区间')});
  });
});
describe('对比候选批次',()=>{
  it('只列同配方、开始更早、至少 2 个有效采样点且非自身的批次',()=>{
    const cur=mkBatch('cur',start,[[0,1],[5,2]]);
    const store:Store={version:1,gapMinutes:45,recipes:[],batches:[
      cur,
      mkBatch('earlier-ok','2026-08-01T08:00',[[0,1],[1,2]]),
      mkBatch('same-start',start,[[0,1],[1,2]]),
      mkBatch('later','2026-10-01T08:00',[[0,1],[1,2]]),
      mkBatch('earlier-few','2026-08-01T08:00',[[0,1]]),
      mkBatch('earlier-other-recipe','2026-08-01T08:00',[[0,1],[1,2]],'r9'),
    ]};
    expect(compareCandidates(store,cur).map(b=>b.id)).toEqual(['earlier-ok']);
  });
  it('同一时刻重复的采样点只计一次，不能满足两点条件',()=>{
    const dup=mkBatch('dup','2026-08-01T08:00',[[5,100],[5,200],[9,300]]);
    expect(validPoints(dup).map(p=>p.minute)).toEqual([5,9]);
    expect(validPoints(dup)[0].temperature).toBe(100);
    const onlyDup=mkBatch('only-dup','2026-08-01T08:00',[[5,100],[5,200]]);
    expect(validPoints(onlyDup)).toHaveLength(1);
    const cur=mkBatch('cur',start,[[0,1],[5,2]]);
    expect(compareCandidates({version:1,gapMinutes:45,recipes:[],batches:[cur,onlyDup]},cur)).toEqual([]);
    const r=compareCurves(cur,onlyDup);
    expect(r).toEqual({kind:'error',reason:expect.stringContaining('参考批次有效采样点不足')});
  });
});
describe('时区：东八区 CSV 导入',()=>{
  const oldTz=process.env.TZ;
  afterEach(()=>{process.env.TZ=oldTz});
  it('CSV 时刻按本地墙钟保存，对比经过分钟从 0 开始而非负数',()=>{
    process.env.TZ='Asia/Shanghai';
    const r=parseCsv('时间,温度\n2026-09-08 08:30,26\n2026-09-08 09:00,120');
    expect(r.errors).toEqual([]);
    expect(r.samples[0].time).toBe('2026-09-08T08:30');
    expect(r.samples[1].time).toBe('2026-09-08T09:00');
    const cur:Batch={id:'c',name:'c',kiln:'K',recipeId:'r1',start:'2026-09-08T08:30',notes:'',samples:r.samples,reviews:{}};
    expect(validPoints(cur).map(p=>p.minute)).toEqual([0,30]);
    const ref=mkBatch('r','2026-09-01T08:30',[[0,26],[30,120]]);
    const out=compareCurves(cur,ref);
    if(out.kind!=='ok')throw new Error('expected ok');
    expect(out.nodes[0].minute).toBe(0);
    expect(out.nodes[0].diff).toBe(0);
  });
  it('带时区偏移的时间字符串也按本地墙钟归一',()=>{
    process.env.TZ='Asia/Shanghai';
    const r=parseCsv('时间,温度\n2026-09-08T08:30+08:00,26');
    expect(r.samples[0].time).toBe('2026-09-08T08:30');
  });
});
