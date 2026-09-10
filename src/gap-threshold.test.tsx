import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import App from './App';
import {STORE_KEY} from './data';
import type {Batch,Recipe,Store} from './types';

// 固定采样：间隔 5、10、5 分钟（目标 100±1000，排除越界异常，只剩间隔异常）
const t0='2026-09-01T08:00';
const gapPoints=[[t0,50],['2026-09-01T08:05',52],['2026-09-01T08:15',55],['2026-09-01T08:20',58]] as Array<[string,number]>;
const GAP_KEY='gap-2026-09-01T08:15';
const recipe:Recipe={id:'r1',name:'试烧配方',target:100,tolerance:1000,duration:600};
function batch(id:string,name:string,extra:Partial<Batch>={}):Batch{
  return {id,name,kiln:'K-01',recipeId:'r1',start:t0,notes:'',samples:gapPoints.map(([time,temperature])=>({time,temperature})),reviews:{},...extra};
}
function seed(gapMinutes:number,batches:Batch[]){
  const store:Store={version:1,gapMinutes,recipes:[recipe],batches};
  localStorage.setItem(STORE_KEY,JSON.stringify(store));
}
const saved=():Store=>JSON.parse(localStorage.getItem(STORE_KEY)!);
const savedBatch=(id:string)=>saved().batches.find(b=>b.id===id)!;
function openBatch(name:RegExp){fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));fireEvent.click(screen.getByRole('button',{name}))}
function goto(name:string){fireEvent.click(screen.getByRole('button',{name}))}
const anomalyRows=()=>screen.queryAllByLabelText('异常状态');
const pendingCount=()=>screen.getByTestId('pending-count').textContent;
function startCustom(){fireEvent.click(screen.getByRole('button',{name:'改用本批次自定义值'}))}
const customInput=()=>screen.getByLabelText('自定义最大采样间隔分钟数') as HTMLInputElement;
function saveCustom(v:string){fireEvent.change(customInput(),{target:{value:v}});fireEvent.click(screen.getByRole('button',{name:'保存自定义值'}))}

beforeEach(()=>{localStorage.clear();vi.stubGlobal('confirm',()=>true)});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('批次自定义最大采样间隔',()=>{
  it('自定义阈值立即改变间隔异常；非法输入停留编辑态；复核状态与备注不被改写；切回统一值后恢复',async()=>{
    seed(5,[batch('a','自定义批次'),batch('b','继承批次')]);
    render(<App/>);
    openBatch(/自定义批次/);
    // 统一值 5 分钟：仅 10 分钟间隔构成 1 条异常
    expect(anomalyRows()).toHaveLength(1);
    expect(screen.getByText(/采样间隔超过 5 分钟/)).toBeInTheDocument();
    // 先把现存异常复核为设备问题并备注
    fireEvent.change(screen.getByLabelText('异常状态'),{target:{value:'equipment'}});
    fireEvent.change(screen.getByLabelText('复核备注'),{target:{value:'热电偶松动'}});
    // 此时概览仅 b 的 1 条待复核
    goto('概览');
    expect(pendingCount()).toBe('1');

    // 空值：留在编辑态、就地提示，不写入、统计不刷新
    openBatch(/自定义批次/);
    startCustom();
    fireEvent.click(screen.getByRole('button',{name:'保存自定义值'}));
    expect(screen.getByTestId('gap-error').textContent).toContain('请输入分钟数');
    expect(anomalyRows()).toHaveLength(1);
    expect(savedBatch('a').gapMinutesOverride).toBeUndefined();

    // 合法自定义值 10：10 分钟间隔不再超限，异常消失，来源标注为批次自定义
    saveCustom('10');
    expect(screen.queryByTestId('gap-error')).toBeNull();
    expect(anomalyRows()).toHaveLength(0);
    expect(screen.getByTestId('gap-source').textContent).toContain('本批次自定义 10 分钟');
    expect(savedBatch('a').gapMinutesOverride).toBe(10);
    // 现存复核结果原样保留，不被阈值来源变化改写
    expect(savedBatch('a').reviews[GAP_KEY]).toEqual({status:'equipment',note:'热电偶松动'});
    goto('概览');
    expect(pendingCount()).toBe('1');

    // 改回统一值：覆盖值被删除，异常立即恢复且沿用原复核状态与备注
    openBatch(/自定义批次/);
    fireEvent.click(screen.getByRole('button',{name:'改回统一值'}));
    expect(screen.getByTestId('gap-source').textContent).toContain('工作台统一值 5 分钟');
    expect(savedBatch('a').gapMinutesOverride).toBeUndefined();
    expect(anomalyRows()).toHaveLength(1);
    expect((screen.getByLabelText('异常状态') as HTMLSelectElement).value).toBe('equipment');
    expect((screen.getByLabelText('复核备注') as HTMLInputElement).value).toBe('热电偶松动');
  });

  it('修改全局值时仅使用统一值的批次联动重算，自定义批次保持不变',async()=>{
    // a 持久化自定义 10 分钟；b 继承全局 5 分钟
    seed(5,[batch('a','自定义批次',{gapMinutesOverride:10}),batch('b','继承批次')]);
    render(<App/>);
    openBatch(/自定义批次/);
    expect(anomalyRows()).toHaveLength(0);
    expect(screen.getByTestId('gap-source').textContent).toContain('本批次自定义 10 分钟');
    goto('概览');
    expect(pendingCount()).toBe('1'); // 只有继承批次 b 有待复核异常

    // 全局值改为 4 分钟（5、10、5 三个间隔全部超限）
    goto('数据与设置');
    const globalInput=screen.getByLabelText('工作台统一最大采样间隔分钟数');fireEvent.change(globalInput,{target:{value:'4'}});fireEvent.blur(globalInput);

    goto('概览');
    expect(pendingCount()).toBe('3'); // 仅 b 联动：3 条异常
    openBatch(/自定义批次/);
    expect(anomalyRows()).toHaveLength(0); // a 不受影响
    expect(screen.getByTestId('gap-source').textContent).toContain('本批次自定义 10 分钟');
    expect(savedBatch('a').gapMinutesOverride).toBe(10);
    openBatch(/继承批次/);
    expect(anomalyRows()).toHaveLength(3);
    expect(screen.getAllByText(/采样间隔超过 4 分钟/)).toHaveLength(3);
  });

  it('非法输入（空、小于 1、非整数）保持当前结果，取消后回到统一值视图',async()=>{
    seed(5,[batch('a','唯一批次')]);
    render(<App/>);
    openBatch(/唯一批次/);
    expect(anomalyRows()).toHaveLength(1);
    startCustom();

    fireEvent.click(screen.getByRole('button',{name:'保存自定义值'}));
    expect(screen.getByTestId('gap-error').textContent).toContain('请输入分钟数');
    saveCustom('0');
    expect(screen.getByTestId('gap-error').textContent).toContain('不能小于 1 分钟');
    saveCustom('1.5');
    expect(screen.getByTestId('gap-error').textContent).toContain('必须是整数');
    saveCustom('abc');
    expect(screen.getByTestId('gap-error').textContent).toContain('必须是整数');

    // 任何非法尝试都不写入数据、不刷新统计、列表保持 1 条
    expect(savedBatch('a').gapMinutesOverride).toBeUndefined();
    expect(anomalyRows()).toHaveLength(1);

    // 取消后离开编辑态，继续使用统一值
    fireEvent.click(screen.getByRole('button',{name:'取消'}));
    expect(screen.queryByLabelText('自定义最大采样间隔分钟数')).toBeNull();
    expect(screen.getByTestId('gap-source').textContent).toContain('工作台统一值 5 分钟');
    expect(anomalyRows()).toHaveLength(1);
    goto('概览');
    expect(pendingCount()).toBe('1');
  });

  it('切回统一值后立即采用最新全局设置，详情异常与概览计数一致',async()=>{
    // 自定义 10 时无异常；随后全局改为 9 分钟（10 分钟间隔超限）
    seed(5,[batch('a','自定义批次',{gapMinutesOverride:10})]);
    render(<App/>);
    openBatch(/自定义批次/);
    expect(anomalyRows()).toHaveLength(0);
    goto('数据与设置');
    const globalInput=screen.getByLabelText('工作台统一最大采样间隔分钟数');fireEvent.change(globalInput,{target:{value:'9'}});fireEvent.blur(globalInput);
    openBatch(/自定义批次/);
    expect(anomalyRows()).toHaveLength(0); // 自定义期间不联动
    expect(screen.getByTestId('gap-source').textContent).toContain('本批次自定义 10 分钟');

    fireEvent.click(screen.getByRole('button',{name:'改回统一值'}));
    expect(savedBatch('a').gapMinutesOverride).toBeUndefined();
    expect(screen.getByTestId('gap-source').textContent).toContain('工作台统一值 9 分钟');
    expect(anomalyRows()).toHaveLength(1);
    expect(screen.getByText(/采样间隔超过 9 分钟/)).toBeInTheDocument();
    goto('概览');
    expect(pendingCount()).toBe('1'); // 详情 1 条、概览待复核 1，一致
  });

  it('超长整数分钟数就地提示且不写入，刷新后本地数据保持原样',async()=>{
    seed(5,[batch('a','唯一批次')]);
    render(<App/>);
    openBatch(/唯一批次/);
    expect(anomalyRows()).toHaveLength(1);
    startCustom();
    saveCustom('9'.repeat(400)); // Number() 会得到 Infinity
    expect(screen.getByTestId('gap-error').textContent).toContain('分钟数过大');
    expect(savedBatch('a').gapMinutesOverride).toBeUndefined();
    // 统计不刷新、JSON 中没有 Infinity 被序列化成 null 的痕迹
    expect(anomalyRows()).toHaveLength(1);
    expect(localStorage.getItem(STORE_KEY)!).not.toContain('null');

    // 刷新后批次与采样完好，仍按统一值判定
    cleanup();render(<App/>);
    openBatch(/唯一批次/);
    expect(anomalyRows()).toHaveLength(1);
    expect(screen.getByTestId('gap-source').textContent).toContain('工作台统一值 5 分钟');
    expect(savedBatch('a').samples).toHaveLength(4);
  });

  it('历史损坏存档（覆盖值被序列化为 null）加载时清洗而非整体丢失',async()=>{
    const corrupted={version:1,gapMinutes:5,recipes:[recipe],batches:[{...batch('a','损坏批次'),gapMinutesOverride:null},{...batch('b','正常批次',{gapMinutesOverride:10}),id:'b2',name:'自定义批次'}]};
    localStorage.setItem(STORE_KEY,JSON.stringify(corrupted));
    render(<App/>);
    openBatch(/损坏批次/);
    // 损坏覆盖值被删除，按统一值 5 分钟判定（10 分钟间隔异常仍在）
    expect(anomalyRows()).toHaveLength(1);
    expect(screen.getByTestId('gap-source').textContent).toContain('工作台统一值 5 分钟');
    expect(savedBatch('a').gapMinutesOverride).toBeUndefined();
    // 其他批次数据完好，合法覆盖值保留
    openBatch(/自定义批次/);
    expect(anomalyRows()).toHaveLength(0);
    expect(savedBatch('b2').gapMinutesOverride).toBe(10);
  });

  it('旧本地数据缺少间隔覆盖字段时按统一值加载',async()=>{
    const legacy={version:1,gapMinutes:5,recipes:[recipe],batches:[{id:'a',name:'旧批次',kiln:'K-01',recipeId:'r1',start:t0,notes:'',samples:gapPoints.map(([time,temperature])=>({time,temperature})),reviews:{}}]};
    localStorage.setItem(STORE_KEY,JSON.stringify(legacy));
    render(<App/>);
    openBatch(/旧批次/);
    expect(anomalyRows()).toHaveLength(1);
    expect(screen.getByTestId('gap-source').textContent).toContain('工作台统一值 5 分钟');
    expect(savedBatch('a').gapMinutesOverride).toBeUndefined();
  });
});
