import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import App from './App';
import {STORE_KEY} from './data';
import type {Batch,Recipe,Store} from './types';

// 当前数据：统一间隔 45 分钟，批次采样在目标范围内且间隔不超限（0 条异常）
const recipe:Recipe={id:'r1',name:'青瓷还原烧',target:1280,tolerance:15,duration:720};
const baseBatch:Batch={id:'b1',name:'在烧批次',kiln:'K-01',recipeId:'r1',start:'2026-09-01T08:00',notes:'',samples:[{time:'2026-09-01T08:00',temperature:1270},{time:'2026-09-01T08:10',temperature:1280},{time:'2026-09-01T08:20',temperature:1290}],reviews:{}};
const current:Store={version:1,gapMinutes:45,recipes:[recipe],batches:[baseBatch]};
const saved=()=>JSON.parse(localStorage.getItem(STORE_KEY)!);
const backup=(x:unknown)=>new File([JSON.stringify(x)],'backup.json',{type:'application/json'});

function importFile(file:File){
  fireEvent.click(screen.getByRole('button',{name:'数据与设置'}));
  const input=document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input,{target:{files:[file]}});
}

beforeEach(()=>{localStorage.clear();localStorage.setItem(STORE_KEY,JSON.stringify(current));vi.stubGlobal('confirm',()=>true)});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('完整备份导入：非法备份整份拒绝且不覆盖当前数据',()=>{
  it('统一间隔为零且含相邻采样的备份被拒绝，不再把所有正向间隔误判为异常',async()=>{
    const evil={version:1,gapMinutes:0,recipes:[recipe],batches:[{...baseBatch,id:'b2',name:'零间隔批次'}]};
    render(<App/>);
    importFile(backup(evil));
    expect(await screen.findByText('备份格式无效，当前数据未更改')).toBeInTheDocument();
    // 当前数据未被覆盖，统计页 0 条待复核（而非全部正向间隔异常）
    expect(saved()).toEqual(current);
    fireEvent.click(screen.getByRole('button',{name:'概览'}));
    expect(screen.getByTestId('pending-count').textContent).toBe('0');
  });

  it('采样时间逆序且间隔超限的备份被拒绝，数据不变',async()=>{
    // 正向看间隔 120 分钟（超限），逆序存放时不应被静默导入
    const reversed={version:1,gapMinutes:45,recipes:[recipe],batches:[{id:'b2',name:'逆序批次',kiln:'K-01',recipeId:'r1',start:'2026-09-01T08:00',notes:'',samples:[{time:'2026-09-01T10:00',temperature:1280},{time:'2026-09-01T08:00',temperature:1270}],reviews:{}}]};
    render(<App/>);
    importFile(backup(reversed));
    expect(await screen.findByText('备份格式无效，当前数据未更改')).toBeInTheDocument();
    expect(saved()).toEqual(current);
    fireEvent.click(screen.getByRole('button',{name:'概览'}));
    expect(screen.getByTestId('pending-count').textContent).toBe('0');
  });

  it('复核记录为空且存在异常的备份被拒绝，统计页不崩溃且保留原数据',async()=>{
    const broken={version:1,gapMinutes:45,recipes:[recipe],batches:[{id:'b2',name:'空复核批次',kiln:'K-01',recipeId:'r1',start:'2026-09-01T08:00',notes:'',samples:[{time:'2026-09-01T08:00',temperature:1300},{time:'2026-09-01T08:10',temperature:1280}],reviews:null}]};
    render(<App/>);
    importFile(backup(broken));
    expect(await screen.findByText('备份格式无效，当前数据未更改')).toBeInTheDocument();
    expect(saved()).toEqual(current);
    // 异常统计页正常打开：待复核为 0，原批次数据完好
    fireEvent.click(screen.getByRole('button',{name:'概览'}));
    expect(screen.getByTestId('pending-count').textContent).toBe('0');
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/在烧批次/}));
    expect(screen.getByText(/当前记录未发现异常/)).toBeInTheDocument();
  });

  it('异常状态为未知值且含异常的备份被拒绝导入',async()=>{
    const unknown={version:1,gapMinutes:45,recipes:[recipe],batches:[{id:'b2',name:'未知状态批次',kiln:'K-01',recipeId:'r1',start:'2026-09-01T08:00',notes:'',samples:[{time:'2026-09-01T08:00',temperature:1300},{time:'2026-09-01T08:10',temperature:1280}],reviews:{'range-2026-09-01T08:00':{status:'unknown',note:''}}}]};
    render(<App/>);
    importFile(backup(unknown));
    expect(await screen.findByText('备份格式无效，当前数据未更改')).toBeInTheDocument();
    expect(saved()).toEqual(current);
    fireEvent.click(screen.getByRole('button',{name:'概览'}));
    expect(screen.getByTestId('pending-count').textContent).toBe('0');
  });

  it('含异常与合法复核记录的备份仍可正常导入并计入统计',async()=>{
    const good:Store={version:1,gapMinutes:45,recipes:[recipe],batches:[{id:'b2',name:'含异常批次',kiln:'K-02',recipeId:'r1',start:'2026-09-01T08:00',notes:'',samples:[{time:'2026-09-01T08:00',temperature:1300},{time:'2026-09-01T08:10',temperature:1400}],reviews:{'range-2026-09-01T08:00':{status:'equipment',note:'热电偶松动'}}}]};
    render(<App/>);
    importFile(backup(good));
    expect(await screen.findByText('备份导入成功')).toBeInTheDocument();
    // 两条越界异常：一条已归类设备问题，另一条待复核
    fireEvent.click(screen.getByRole('button',{name:'概览'}));
    expect(screen.getByTestId('pending-count').textContent).toBe('1');
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/含异常批次/}));
    const statuses=screen.getAllByLabelText('异常状态') as HTMLSelectElement[];
    expect(statuses.map(s=>s.value)).toEqual(['equipment','pending']);
  });
});
