import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import App from './App';
import {STORE_KEY} from './data';
import type {Batch,Recipe,Store} from './types';

const recipes:Recipe[]=[{id:'r1',name:'青瓷还原烧',target:1280,tolerance:15,duration:720},{id:'r2',name:'素烧',target:900,tolerance:20,duration:480}];
const wall=(start:string,min:number)=>{const d=new Date(Date.parse(start)+min*60000);const p=(v:number)=>String(v).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`};
function batch(id:string,name:string,start:string,pts:Array<[number,number]>,extra:Partial<Batch>={}):Batch{
  return {id,name,kiln:'K-01',recipeId:'r1',start,notes:'',samples:pts.map(([m,t])=>({time:wall(start,m),temperature:t})),reviews:{},...extra};
}
const s0='2026-09-10T08:00';
const cur=batch('cur','当前批次',s0,[[0,100],[10,110],[20,120]]);
const earlier=batch('earlier','较早批次','2026-09-01T08:00',[[0,100],[10,105],[20,115]]);
const later=batch('later','更晚批次','2026-09-12T08:00',[[0,100],[10,105],[20,115]]);
const mkStore=(batches:Batch[]):Store=>({version:1,gapMinutes:45,recipes,batches});
const optionTexts=()=>Array.from((screen.getByLabelText('参考批次') as HTMLSelectElement).options).map(o=>o.textContent||'');

async function openDetail(name=/当前批次/){
  render(<App/>);
  fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
  fireEvent.click(screen.getByRole('button',{name}));
}
async function importBackup(store:Store){
  render(<App/>);
  fireEvent.click(screen.getByRole('button',{name:'数据与设置'}));
  const input=document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input,{target:{files:[new File([JSON.stringify(store)],'backup.json',{type:'application/json'})]}});
  await screen.findByText('备份导入成功');
  fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
}

beforeEach(()=>{localStorage.clear();vi.stubGlobal('confirm',()=>true)});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('历史参考批次选择约束',()=>{
  it('打开当前批次时，开始更晚的同配方批次不出现在历史参考选项，仅较早批次可选',async()=>{
    localStorage.setItem(STORE_KEY,JSON.stringify(mkStore([cur,earlier,later])));
    await openDetail();
    const names=optionTexts();
    expect(names.some(t=>t.includes('较早批次'))).toBe(true);
    expect(names.some(t=>t.includes('更晚批次'))).toBe(false);
    // 较早批次仍可作为参考并生成差异摘要
    fireEvent.change(screen.getByLabelText('参考批次'),{target:{value:'earlier'}});
    expect(await screen.findByTestId('compare-summary')).toBeInTheDocument();
    expect(screen.getByTestId('node-count').textContent).toBe('21');
    expect(screen.getByTestId('max-diff').textContent).toBe('5.0 °C');
    expect(screen.getByTestId('max-minute').textContent).toBe('10');
  });

  it('选择参考后把当前批次改为其他配方，提示参考批次已不再可用且不再显示差异摘要',async()=>{
    localStorage.setItem(STORE_KEY,JSON.stringify(mkStore([cur,earlier])));
    await openDetail();
    fireEvent.change(screen.getByLabelText('参考批次'),{target:{value:'earlier'}});
    await screen.findByTestId('compare-summary');
    // 编辑当前批次，把配方从青瓷还原烧改为素烧
    fireEvent.click(screen.getByText('编辑批次信息'));
    const detail=document.querySelector('.detail')!;
    fireEvent.change(detail.querySelector('select[name=recipeId]') as HTMLSelectElement,{target:{value:'r2'}});
    fireEvent.click(within(detail).getAllByRole('button',{name:'保存批次'})[0]);
    // 跨配方参考不再可用：显示提示、摘要与参考曲线消失、保留当前曲线
    await waitFor(()=>expect(document.querySelector('.compareError')?.textContent).toContain('不再可用'));
    expect(screen.queryByTestId('compare-summary')).toBeNull();
    expect(screen.queryByTestId('reference-line')).toBeNull();
    expect(screen.getByRole('img',{name:'实际温度与目标范围折线图'})).toBeInTheDocument();
    // 原参考选择保留并标记为不可用，可清除后恢复
    const select=screen.getByLabelText('参考批次') as HTMLSelectElement;
    expect(select.value).toBe('earlier');
    expect(optionTexts().some(t=>t.includes('较早批次')&&t.includes('已不可用'))).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'清除对比'}));
    expect(document.querySelector('.compareError')).toBeNull();
    expect((screen.getByLabelText('参考批次') as HTMLSelectElement).value).toBe('');
  });

  it('导入含同一时刻两个采样点的完整备份后，该批次不满足两点条件、不列为候选',async()=>{
    const dup:Batch={id:'dup',name:'重复时刻批次',kiln:'K-01',recipeId:'r1',start:'2026-09-01T08:00',notes:'',samples:[{time:'2026-09-01T08:30',temperature:100},{time:'2026-09-01T08:30',temperature:200}],reviews:{}};
    await importBackup(mkStore([cur,dup]));
    fireEvent.click(screen.getByRole('button',{name:/当前批次/}));
    expect(optionTexts().some(t=>t.includes('重复时刻批次'))).toBe(false);
    expect(screen.getByText(/还没有满足条件的同配方历史批次/)).toBeInTheDocument();
  });

  it('导入参考编号等于当前编号的完整备份后，显示不可用提示而非全零差异摘要',async()=>{
    const selfRef:Batch={...cur,id:'self',name:'自引用批次',referenceBatchId:'self'};
    await importBackup(mkStore([selfRef,earlier]));
    fireEvent.click(screen.getByRole('button',{name:/自引用批次/}));
    await waitFor(()=>expect(document.querySelector('.compareError')?.textContent).toContain('不可用'));
    // 不生成全零差异摘要，也不叠加参考曲线
    expect(screen.queryByTestId('compare-summary')).toBeNull();
    expect(screen.queryByTestId('max-diff')).toBeNull();
    expect(screen.queryByTestId('reference-line')).toBeNull();
    expect(screen.getByRole('img',{name:'实际温度与目标范围折线图'})).toBeInTheDocument();
    // 自身引用在下拉中标记为不可用
    const select=screen.getByLabelText('参考批次') as HTMLSelectElement;
    expect(select.value).toBe('self');
    expect(optionTexts().some(t=>t.includes('自引用批次')&&t.includes('已不可用'))).toBe(true);
  });
});
