import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import App from './App';
import {STORE_KEY} from './data';
import type {Batch,Recipe,Store} from './types';

function batch(id:string,name:string,start:string,pts:Array<[string,number]>,extra:Partial<Batch>={}):Batch{
  return {id,name,kiln:'K-01',recipeId:'r1',start,notes:'',samples:pts.map(([time,temperature])=>({time,temperature})),reviews:{},...extra};
}
// 固定样本（不等间隔）：当前 0,4,10,20 分钟；good 参考 0,3,10,15,20 分钟
const s0='2026-09-01T08:00';
const s1='2026-08-05T06:00';
const cur=batch('cur','当前批次',s0,[[s0,100],['2026-09-01T08:04',104],['2026-09-01T08:10',110],['2026-09-01T08:20',120]]);
const good=batch('good','九月青瓷 A 批',s1,[[s1,100],['2026-08-05T06:03',109],['2026-08-05T06:10',150],['2026-08-05T06:15',175],['2026-08-05T06:20',200]]);
// 采样区间无交集：覆盖经过分钟 30..40
const noOverlap=batch('no','无交集批次','2026-08-01T00:00',[['2026-08-01T00:30',100],['2026-08-01T00:40',200]]);
// 仅 1 个采样点：不应出现在候选列表
const few=batch('few','采样不足批次','2026-07-01T00:00',[['2026-07-01T00:00',100]]);
// 不同配方：不应出现在候选列表
const other=batch('other','别的配方批次','2026-06-01T00:00',[['2026-06-01T00:00',100],['2026-06-01T00:10',120]],{recipeId:'r2'});
const recipes:Recipe[]=[{id:'r1',name:'青瓷还原烧',target:1280,tolerance:15,duration:720},{id:'r2',name:'素烧',target:900,tolerance:20,duration:480}];

function seed(extra:Partial<Store>={},batches:Batch[]=[cur,good,noOverlap,few,other]){
  const store:Store={version:1,gapMinutes:45,recipes,batches,...extra};
  localStorage.setItem(STORE_KEY,JSON.stringify(store));
  return store;
}
async function openDetail(){
  render(<App/>);
  fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
  fireEvent.click(screen.getByRole('button',{name:/当前批次/}));
}

beforeEach(()=>{localStorage.clear();vi.stubGlobal('confirm',()=>true)});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('批次详情：同配方历史曲线对比主流程',()=>{
  it('选择有效参考批次后生成差异摘要、叠加参考曲线，清除后回到当前曲线',async()=>{
    seed();
    await openDetail();
    const select=screen.getByLabelText('参考批次') as HTMLSelectElement;
    // 候选只含同配方且 ≥2 采样点的批次
    const names=Array.from(select.options).map(o=>o.textContent);
    expect(names.some(t=>t!.includes('九月青瓷 A 批'))).toBe(true);
    expect(names.some(t=>t!.includes('无交集批次'))).toBe(true);
    expect(names.some(t=>t!.includes('采样不足批次'))).toBe(false);
    expect(names.some(t=>t!.includes('别的配方批次'))).toBe(false);

    fireEvent.change(select,{target:{value:'good'}});

    // 固定样本断言：节点集合 0..20、最大 80.0 °C 发生在第 20 分钟、平均 38.6
    const summary=await screen.findByTestId('compare-summary');
    expect(screen.getByTestId('node-count').textContent).toBe('21');
    expect(screen.getByTestId('max-diff').textContent).toBe('80.0 °C');
    expect(screen.getByTestId('max-minute').textContent).toBe('20');
    expect(screen.getByTestId('avg-diff').textContent).toBe('38.6 °C');
    expect(summary.textContent).toContain('九月青瓷 A 批');

    // 图表按同一经过时间轴叠加参考曲线
    const svg=screen.getByRole('img',{name:'当前批次与参考批次烧成曲线对比图'});
    expect(within(svg).getByTestId('reference-line')).toBeInTheDocument();
    expect(within(svg).getAllByTestId('reference-point')).toHaveLength(5);
    expect(svg.textContent).toContain('经过分钟');
    // 图例断言
    const legend=document.querySelector('.legend')!;
    expect(legend.textContent).toContain('实际温度（当前批次）');
    expect(legend.textContent).toContain('参考曲线（九月青瓷 A 批）');
    expect(legend.textContent).toContain('目标线');
    expect(legend.textContent).toContain('允许范围');

    // 选择已持久化
    const saved:Store=JSON.parse(localStorage.getItem(STORE_KEY)!);
    expect(saved.batches.find(b=>b.id==='cur')!.referenceBatchId).toBe('good');

    // 清除选择回到当前曲线
    fireEvent.click(screen.getByRole('button',{name:'清除对比，回到当前曲线'}));
    expect(screen.queryByTestId('compare-summary')).toBeNull();
    expect(screen.queryByTestId('reference-line')).toBeNull();
    expect(screen.getByRole('img',{name:'实际温度与目标范围折线图'})).toBeInTheDocument();
    expect(screen.getByLabelText('参考批次').value).toBe('');
    expect(JSON.parse(localStorage.getItem(STORE_KEY)!).batches.find((b:Batch)=>b.id==='cur').referenceBatchId).toBeUndefined();
  });

  it('无共同覆盖区间时显示具体原因、保留当前曲线、不展示旧摘要，可改选有效批次',async()=>{
    seed();
    await openDetail();
    fireEvent.change(screen.getByLabelText('参考批次'),{target:{value:'no'}});
    const alert=await screen.findByRole('alert');
    expect(alert.textContent).toContain('没有共同覆盖区间');
    expect(screen.queryByTestId('compare-summary')).toBeNull();
    expect(screen.queryByTestId('reference-line')).toBeNull();
    expect(screen.getByRole('img',{name:'实际温度与目标范围折线图'})).toBeInTheDocument();

    // 失败后改选有效批次
    fireEvent.change(screen.getByLabelText('参考批次'),{target:{value:'good'}});
    expect(await screen.findByTestId('compare-summary')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('max-diff').textContent).toBe('80.0 °C');
  });

  it('参考批次被删除后显示具体原因、保留当前曲线，再改选有效批次恢复',async()=>{
    seed();
    await openDetail();
    fireEvent.change(screen.getByLabelText('参考批次'),{target:{value:'good'}});
    await screen.findByTestId('compare-summary');
    // 删除参考批次本身：切到它再删
    fireEvent.click(screen.getByRole('button',{name:/九月青瓷 A 批/}));
    fireEvent.click(screen.getByRole('button',{name:'删除'}));
    // 回到当前批次
    fireEvent.click(screen.getByRole('button',{name:/当前批次/}));
    const alert=await screen.findByRole('alert');
    expect(alert.textContent).toContain('参考批次已被删除');
    expect(screen.queryByTestId('compare-summary')).toBeNull();
    expect(screen.queryByTestId('reference-line')).toBeNull();
    expect(screen.getByRole('img',{name:'实际温度与目标范围折线图'})).toBeInTheDocument();
    // 改选仍可用的有效批次（无交集批次先失败，验证可继续切换）
    fireEvent.change(screen.getByLabelText('参考批次'),{target:{value:'no'}});
    expect((await screen.findByRole('alert')).textContent).toContain('没有共同覆盖区间');
    // 清除失败选择也能回到纯净当前曲线
    fireEvent.click(screen.getByRole('button',{name:'清除对比'}));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('参考批次').value).toBe('');
  });

  it('参考批次采样不足时提示原因',async()=>{
    // 持久化指向采样不足批次（模拟旧选择后参考数据被改），按未对比加载并给出原因
    const dangling={...cur,referenceBatchId:'few'};
    seed({batches:[dangling,good,few]});
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/当前批次/}));
    const alert=await screen.findByRole('alert');
    expect(alert.textContent).toContain('采样点不足');
    expect(screen.queryByTestId('compare-summary')).toBeNull();
  });

  it('选择参考批次后再编辑当前批次，对比选择继续保留',async()=>{
    seed();
    await openDetail();
    fireEvent.change(screen.getByLabelText('参考批次'),{target:{value:'good'}});
    await screen.findByTestId('compare-summary');
    // 展开“编辑批次信息”并修改名称后保存（限定在详情面板，避开列表中的创建表单）
    fireEvent.click(screen.getByText('编辑批次信息'));
    const detail=document.querySelector('.detail')!;
    const nameInput=detail.querySelector('input[name=name]') as HTMLInputElement;
    fireEvent.change(nameInput,{target:{value:'当前批次-改名'}});
    fireEvent.click(within(detail).getAllByRole('button',{name:'保存批次'})[0]);
    // 参考选择与对比摘要仍在
    expect((screen.getByLabelText('参考批次') as HTMLSelectElement).value).toBe('good');
    expect(screen.getByTestId('compare-summary')).toBeInTheDocument();
    expect(screen.getByTestId('reference-line')).toBeInTheDocument();
    const saved:Store=JSON.parse(localStorage.getItem(STORE_KEY)!);
    const b=saved.batches.find(x=>x.id==='cur')!;
    expect(b.referenceBatchId).toBe('good');
    expect(b.name).toBe('当前批次-改名');
  });

  it('当前批次采样不足 2 点时不提供对比入口',async()=>{
    seed({batches:[few,good]});
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/采样不足批次/}));
    expect(screen.queryByLabelText('参考批次')).toBeNull();
    expect(screen.getByText(/至少需要 2 个有效采样点/)).toBeInTheDocument();
  });
});
