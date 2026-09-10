import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import App from './App';
import {appendCsv,STORE_KEY} from './data';
import type {Batch,Recipe,Store} from './types';

const recipes:Recipe[]=[{id:'r1',name:'青瓷还原烧',target:1280,tolerance:15,duration:720}];
const wall=(start:string,min:number)=>{const d=new Date(Date.parse(start)+min*60000);const p=(v:number)=>String(v).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`};
const s0='2026-09-10T08:00';
// 当前批次：08:00 越界且已复核、08:20 正常；已选择同配方历史参考批次
const cur:Batch={id:'cur',name:'当前批次',kiln:'K-01',recipeId:'r1',start:s0,notes:'',samples:[{time:s0,temperature:1260},{time:wall(s0,20),temperature:1280}],reviews:{[`range-${s0}`]:{status:'equipment',note:'热电偶松动'}},referenceBatchId:'ref'};
const ref:Batch={id:'ref',name:'历史批次',kiln:'K-01',recipeId:'r1',start:'2026-09-01T08:00',notes:'',samples:[{time:'2026-09-01T08:00',temperature:1270},{time:'2026-09-01T08:20',temperature:1290}],reviews:{}};
const store:Store={version:1,gapMinutes:45,recipes,batches:[cur,ref]};

const saved=()=>JSON.parse(localStorage.getItem(STORE_KEY)!) as Store;
const savedCur=()=>saved().batches.find(b=>b.id==='cur')!;
const appendInput=()=>screen.getByTestId('append-csv-input') as HTMLInputElement;
const replaceInput=()=>document.querySelector('input[type=file][accept=".csv,text/csv"]') as HTMLInputElement;
const pickFile=(el:HTMLInputElement,file:File)=>{Object.defineProperty(el,'value',{writable:true,value:''});fireEvent.change(el,{target:{files:[file]}})};
const csv=(name:string,rows:string)=>new File([`时间,温度\n${rows}`],name,{type:'text/csv'});

async function openDetail(){
  render(<App/>);
  fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
  fireEvent.click(screen.getByRole('button',{name:/当前批次/}));
}

beforeEach(()=>{localStorage.clear();localStorage.setItem(STORE_KEY,JSON.stringify(store));vi.stubGlobal('confirm',()=>true)});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('appendCsv 合并逻辑',()=>{
  const existing=[{time:'2026-09-10T08:00',temperature:1260},{time:'2026-09-10T08:20',temperature:1280}];
  it('新记录与现有采样合并后按时间升序排列',()=>{
    const r=appendCsv('时间,温度\n2026-09-10 07:50,1255\n2026-09-10 08:10,1275',existing);
    expect(r.errors).toEqual([]);
    expect(r.samples.map(p=>p.time)).toEqual(['2026-09-10T07:50','2026-09-10T08:00','2026-09-10T08:10','2026-09-10T08:20']);
    expect(r.samples.map(p=>p.temperature)).toEqual([1255,1260,1275,1280]);
  });
  it('与当前批次冲突时报首个冲突时间及 CSV 行号',()=>{
    const r=appendCsv('时间,温度\n2026-09-10 08:00,1261\n2026-09-10 08:20,1285',existing);
    expect(r.errors).toEqual(['第 2 行：时间点 2026-09-10 08:00 已存在于当前批次']);
    expect(r.samples).toEqual([]);
  });
  it('文件内部时间重复沿用现有校验，不产生可写入记录',()=>{
    const r=appendCsv('时间,温度\n2026-09-10 08:05,1272\n2026-09-10 08:05,1273',existing);
    expect(r.errors[0]).toContain('第 3 行');
    expect(r.errors[0]).toContain('时间点重复');
    expect(r.samples).toEqual([]);
  });
  it('格式错误时不返回任何合并结果',()=>{
    const r=appendCsv('时间,温度\n2026-09-10 08:05,1272\n2026-09-10 08:10,abc',existing);
    expect(r.errors[0]).toContain('第 3 行');
    expect(r.errors[0]).toContain('温度必须是数字');
    expect(r.samples).toEqual([]);
  });
});

describe('批次详情：追加 CSV',()=>{
  it('有效追加合并新记录并升序排列，曲线与异常列表立即刷新，复核与历史参考保留',async()=>{
    await openDetail();
    // 追加前：仅 1 个已复核异常，历史对比已生效
    expect(screen.getAllByLabelText('异常状态')).toHaveLength(1);
    expect(screen.getByTestId('compare-summary')).toBeInTheDocument();
    pickFile(appendInput(),csv('append.csv','2026-09-10 08:10,1275\n2026-09-10 09:40,1300'));
    expect(await screen.findByText('已追加 2 个采样点，当前共 4 个采样点')).toBeInTheDocument();
    // 合并结果按时间升序一次性写入本地存储
    await waitFor(()=>expect(savedCur().samples.map(p=>p.time)).toEqual([s0,wall(s0,10),wall(s0,20),wall(s0,100)]));
    expect(savedCur().samples.map(p=>p.temperature)).toEqual([1260,1275,1280,1300]);
    // 异常列表立即刷新：新增 1300 越界与 80 分钟采样间隔
    await waitFor(()=>expect(screen.getAllByLabelText('异常状态')).toHaveLength(3));
    expect(screen.getAllByText(/超出 1280 ± 15/)).toHaveLength(2);
    expect(screen.getByText(/采样间隔超过 45 分钟/)).toBeInTheDocument();
    // 原复核结果保留在新异常之前
    const statuses=screen.getAllByLabelText('异常状态') as HTMLSelectElement[];
    expect(statuses.map(s=>s.value)).toEqual(['equipment','pending','pending']);
    expect((screen.getAllByLabelText('复核备注')[0] as HTMLInputElement).value).toBe('热电偶松动');
    // 曲线刷新为合并后的 4 个当前采样点（叠加参考曲线视图保留）
    const svg=screen.getByRole('img',{name:'当前批次与参考批次烧成曲线对比图'});
    expect(svg.querySelectorAll('circle')).toHaveLength(6);
    // 历史参考选择与对比计算保持可用
    expect((screen.getByLabelText('参考批次') as HTMLSelectElement).value).toBe('ref');
    expect(screen.getByTestId('node-count').textContent).toBe('21');
    expect(savedCur().referenceBatchId).toBe('ref');
    expect(savedCur().reviews[`range-${s0}`]).toEqual({status:'equipment',note:'热电偶松动'});
  });

  it('追加文件与当前批次时间冲突时指出首个冲突与行号，曲线、复核和历史参考均保持原样',async()=>{
    await openDetail();
    pickFile(appendInput(),csv('conflict.csv','2026-09-10 08:00,1261\n2026-09-10 08:20,1285'));
    const alert=await screen.findByRole('alert');
    expect(alert.textContent).toContain('第 2 行');
    expect(alert.textContent).toContain('2026-09-10 08:00');
    expect(alert.textContent).toContain('已存在于当前批次');
    // 原采样、复核与历史参考选择均未改变
    expect(savedCur().samples).toEqual(store.batches[0].samples);
    expect(savedCur().reviews).toEqual(store.batches[0].reviews);
    expect(savedCur().referenceBatchId).toBe('ref');
    expect(screen.getAllByLabelText('异常状态')).toHaveLength(1);
    expect(screen.getByTestId('compare-summary')).toBeInTheDocument();
    expect(screen.getByTestId('node-count').textContent).toBe('21');
  });

  it('追加文件内部时间重复时报错且不写入',async()=>{
    await openDetail();
    pickFile(appendInput(),csv('dup.csv','2026-09-10 08:05,1272\n2026-09-10 08:05,1273'));
    const alert=await screen.findByRole('alert');
    expect(alert.textContent).toContain('第 3 行');
    expect(alert.textContent).toContain('时间点重复');
    expect(savedCur().samples).toEqual(store.batches[0].samples);
    expect(screen.getAllByLabelText('异常状态')).toHaveLength(1);
  });

  it('追加文件格式错误时不发生部分写入',async()=>{
    await openDetail();
    // 第 2 行有效、第 3 行温度非法：有效行也不得写入
    pickFile(appendInput(),csv('bad.csv','2026-09-10 08:05,1272\n2026-09-10 08:10,abc'));
    const alert=await screen.findByRole('alert');
    expect(alert.textContent).toContain('第 3 行');
    expect(alert.textContent).toContain('温度必须是数字');
    expect(savedCur().samples).toEqual(store.batches[0].samples);
    expect(screen.getAllByLabelText('异常状态')).toHaveLength(1);
    // 表头错误同样整体拒绝
    pickFile(appendInput(),new File(['time,temp\n2026-09-10 08:05,1272'],'bad2.csv',{type:'text/csv'}));
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('表头必须为“时间,温度”'));
    expect(savedCur().samples).toEqual(store.batches[0].samples);
  });

  it('原有导入 CSV 仍整批替换旧采样，既有历史对比继续正常计算',async()=>{
    await openDetail();
    expect(screen.getByTestId('node-count').textContent).toBe('21');
    pickFile(replaceInput(),csv('replace.csv','2026-09-10 08:00,1270\n2026-09-10 08:30,1285\n2026-09-10 09:00,1290'));
    expect(await screen.findByText('已导入 3 个采样点')).toBeInTheDocument();
    // 旧采样被整批覆盖
    await waitFor(()=>expect(savedCur().samples.map(p=>p.temperature)).toEqual([1270,1285,1290]));
    expect(savedCur().samples.map(p=>p.time)).toEqual([s0,wall(s0,30),wall(s0,60)]);
    // 历史对比在替换后的曲线上继续计算：交集 0..20 分钟，diff=0.5m
    expect(screen.getByTestId('compare-summary')).toBeInTheDocument();
    expect(screen.getByTestId('node-count').textContent).toBe('21');
    expect(screen.getByTestId('max-diff').textContent).toBe('10.0 °C');
    expect(screen.getByTestId('max-minute').textContent).toBe('20');
    expect(screen.getByTestId('avg-diff').textContent).toBe('5.0 °C');
    // 替换只覆盖采样，复核数据仍保留在本地
    expect(savedCur().reviews[`range-${s0}`]).toEqual({status:'equipment',note:'热电偶松动'});
  });

  it('追加结果经完整备份导出再导入后保留',async()=>{
    const readText=(blob:Blob)=>new Promise<string>(res=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.readAsText(blob)});
    let exported='';
    vi.stubGlobal('URL',{...URL,createObjectURL:(blob:Blob)=>{readText(blob).then(t=>{exported=t});return 'blob:x'},revokeObjectURL:()=>{}});
    HTMLAnchorElement.prototype.click=function(){(this as any).dispatchEvent(new Event('click'))};
    await openDetail();
    pickFile(appendInput(),csv('append.csv','2026-09-10 08:10,1275\n2026-09-10 09:40,1300'));
    await screen.findByText('已追加 2 个采样点，当前共 4 个采样点');
    // 导出完整备份
    fireEvent.click(screen.getByRole('button',{name:'数据与设置'}));
    fireEvent.click(screen.getByRole('button',{name:'导出 JSON'}));
    await waitFor(()=>expect(exported).toContain('2026-09-10T09:40'));
    // 清空本地后导入备份，追加结果完整恢复
    localStorage.clear();cleanup();
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'数据与设置'}));
    fireEvent.change(document.querySelector('input[type=file]') as HTMLInputElement,{target:{files:[new File([exported],'backup.json',{type:'application/json'})]}});
    await screen.findByText('备份导入成功');
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/当前批次/}));
    expect(savedCur().samples.map(p=>p.time)).toEqual([s0,wall(s0,10),wall(s0,20),wall(s0,100)]);
    expect(screen.getAllByLabelText('异常状态')).toHaveLength(3);
    expect((screen.getByLabelText('参考批次') as HTMLSelectElement).value).toBe('ref');
    expect(screen.getByTestId('compare-summary')).toBeInTheDocument();
  });
});
