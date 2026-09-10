import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import App from './App';
import {findScheduleConflicts,STORE_KEY} from './data';
import type {Batch,Recipe,Store} from './types';

const recipe:Recipe={id:'r1',name:'固定计划配方',target:1200,tolerance:20,duration:600};
function batch(id:string,name:string,kiln:string,start:string):Batch{
  return {id,name,kiln,recipeId:'r1',start,notes:'',samples:[],reviews:{}};
}
function seed(batches:Batch[]):Store{
  const store:Store={version:1,gapMinutes:45,recipes:[recipe],batches};
  localStorage.setItem(STORE_KEY,JSON.stringify(store));
  return store;
}
function batchesTab(){
  fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
}
function openCreate(){
  fireEvent.click(screen.getByText('＋ 创建批次'));
  return document.querySelector('.listPane form') as HTMLFormElement;
}
function field(form:HTMLFormElement,name:string){
  const byName:Record<string,string>={'批次名称':'name','窑炉编号':'kiln','烧成配方':'recipeId','开始时间':'start','备注':'notes'};
  return form.elements.namedItem(byName[name]) as HTMLInputElement;
}
function setField(form:HTMLFormElement,label:string,value:string){
  fireEvent.change(field(form,label),{target:{value}});
}
function fillCreate(form:HTMLFormElement,kiln:string,start:string,name='新批次'){
  setField(form,'批次名称',name);
  setField(form,'窑炉编号',kiln);
  setField(form,'开始时间',start);
}
const saved=():Store=>JSON.parse(localStorage.getItem(STORE_KEY)!);

beforeEach(()=>{localStorage.clear();vi.stubGlobal('confirm',()=>true)});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('窑炉计划占用冲突',()=>{
  it('同窑炉重叠即时拦截、保存不写入且保留全部输入；首尾相接和不同窑炉可保存',()=>{
    seed([batch('b01','已有批次','K-01','2026-09-10T08:00'),batch('b02','其他窑炉批次','K-02','2026-09-10T08:00')]);
    render(<App/>);
    batchesTab();
    const form=openCreate();

    fillCreate(form,'K-01','2026-09-10T09:00');
    const alert=within(form).getByTestId('schedule-conflict');
    expect(alert.textContent).toContain('首个冲突批次：已有批次（批次编号 b01）');
    expect(alert.textContent).toContain('当前批次占用：2026-09-10 09:00 – 2026-09-10 19:00');
    expect(alert.textContent).toContain('冲突批次占用：2026-09-10 08:00 – 2026-09-10 18:00');
    expect(alert.textContent).toContain('重叠起点：2026-09-10 09:00；重叠 540 分钟');

    fireEvent.click(within(form).getByRole('button',{name:'保存批次'}));
    expect(saved().batches).toHaveLength(2);
    expect(field(form,'批次名称').value).toBe('新批次');
    expect(field(form,'窑炉编号').value).toBe('K-01');
    expect(field(form,'开始时间').value).toBe('2026-09-10T09:00');
    expect(screen.getAllByRole('alert').some(el=>el.textContent?.includes('窑炉计划时间冲突，批次未保存'))).toBe(true);

    // 左闭右开：已有批次 18:00 结束，新批次 18:00 开始属于可连续生产
    fireEvent.change(field(form,'开始时间'),{target:{value:'2026-09-10T18:00'}});
    expect(within(form).getByTestId('schedule-ok')).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button',{name:'保存批次'}));
    expect(saved().batches).toHaveLength(3);
    expect(saved().batches[0]).toMatchObject({name:'新批次',kiln:'K-01',start:'2026-09-10T18:00'});

    // 同一时段不同窑炉并行
    const form2=openCreate();
    fillCreate(form2,'K-03','2026-09-10T08:00','并行批次');
    expect(within(form2).getByTestId('schedule-ok')).toBeInTheDocument();
    fireEvent.click(within(form2).getByRole('button',{name:'保存批次'}));
    expect(saved().batches).toHaveLength(4);
    expect(saved().batches[0]).toMatchObject({name:'并行批次',kiln:'K-03',start:'2026-09-10T08:00'});
  });

  it('编辑当前批次时排除自身，改成与其他批次冲突的时间后给出确定提示且拒绝写入',()=>{
    const store=seed([batch('b01','当前批次','K-01','2026-09-10T08:00'),batch('b02','后续批次','K-01','2026-09-10T18:00'),batch('b03','更早批次','K-01','2026-09-09T20:00')]);
    render(<App/>);
    batchesTab();
    fireEvent.click(screen.getByRole('button',{name:/当前批次/}));
    fireEvent.click(screen.getByText('编辑批次信息'));
    const form=document.querySelector('.detail form') as HTMLFormElement;

    expect(within(form).queryByTestId('schedule-conflict')).toBeNull();
    expect(within(form).getByTestId('schedule-ok')).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button',{name:'保存批次'}));
    expect(saved().batches).toHaveLength(3);

    // 改成 17:00-03:00，与后续批次 18:00-04:00 重叠 540 分钟
    fireEvent.change(field(form,'开始时间'),{target:{value:'2026-09-10T17:00'}});
    const alert=within(form).getByTestId('schedule-conflict');
    expect(alert.textContent).toContain('首个冲突批次：后续批次（批次编号 b02）');
    expect(alert.textContent).toContain('重叠 540 分钟');
    fireEvent.click(within(form).getByRole('button',{name:'保存批次'}));
    expect(saved()).toEqual(store);
    expect(field(form,'开始时间').value).toBe('2026-09-10T17:00');

    // 调整为 06:00-16:00：与更早批次首尾相接，且不碰后续批次，可直接重试
    fireEvent.change(field(form,'开始时间'),{target:{value:'2026-09-10T06:00'}});
    fireEvent.click(within(form).getByRole('button',{name:'保存批次'}));
    expect(saved().batches.find(b=>b.id==='b01')!.start).toBe('2026-09-10T06:00');
  });

  it('批次列表对现有冲突显示醒目标记但不改写数据',()=>{
    const store=seed([batch('b01','早班批次','K-01','2026-09-10T08:00'),batch('b02','重叠批次','K-01','2026-09-10T17:00'),batch('b03','无冲突批次','K-01','2026-09-11T08:00')]);
    render(<App/>);
    batchesTab();
    expect(screen.getAllByTestId('schedule-conflict-badge')).toHaveLength(2);
    expect(saved()).toEqual(store);
  });

  it('纯规则：相邻不冲突、异炉不冲突；真重叠按重叠起点和批次编号稳定排序',()=>{
    const adjacent=findScheduleConflicts([recipe],[batch('b01','A','K1','2026-09-10T08:00'),batch('b02','B','K1','2026-09-10T18:00')]);
    expect(adjacent).toEqual([]);
    const parallel=findScheduleConflicts([recipe],[batch('b01','A','K1','2026-09-10T08:00'),batch('b02','B','K2','2026-09-10T08:00')]);
    expect(parallel).toEqual([]);
    const overlapping=[batch('b10','十号','K1','2026-09-10T08:00'),batch('b2','二号','K1','2026-09-10T08:00'),batch('b1','一号','K1','2026-09-10T08:00')];
    const draft={id:'new',kiln:'K1',recipeId:'r1',start:'2026-09-10T08:30'};
    const conflicts=findScheduleConflicts([recipe],overlapping,draft);
    expect(conflicts.map(c=>c.other.batchId)).toEqual(['b1','b2','b10']);
    expect(conflicts[0].overlapStartMs).toBe(Date.parse('2026-09-10T08:30'));
    expect(conflicts[0].overlapMinutes).toBe(570);
  });
});
