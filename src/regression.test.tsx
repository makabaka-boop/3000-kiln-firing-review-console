import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import App from './App';
import {STORE_KEY} from './data';
import type {Store} from './types';

const store:Store={version:1,gapMinutes:45,recipes:[{id:'r1',name:'青瓷还原烧',target:1280,tolerance:15,duration:720}],batches:[{id:'b1',name:'回归批次',kiln:'K-09',recipeId:'r1',start:'2026-09-01T08:00',notes:'',samples:[],reviews:{}}]};
const pickFile=(el:HTMLInputElement|Element|null,file:File)=>fireEvent.change(el as HTMLInputElement,{target:{files:[file]}});

beforeEach(()=>{localStorage.clear();vi.stubGlobal('confirm',()=>true)});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('原有行为回归',()=>{
  it('CSV 导入成功后写入采样点并反馈，非法 CSV 不覆盖现有曲线',async()=>{
    localStorage.setItem(STORE_KEY,JSON.stringify(store));
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/回归批次/}));
    // 初始空态
    expect(screen.getByText(/导入温度记录后/)).toBeInTheDocument();
    const csv=()=>document.querySelector('input[type=file][accept=".csv,text/csv"]') as HTMLInputElement;
    pickFile(csv(),new File(['时间,温度\n2026-09-01 08:00,1260\n2026-09-01 09:00,1290\n2026-09-01 10:00,1310'],'ok.csv',{type:'text/csv'}));
    expect(await screen.findByText('已导入 3 个采样点')).toBeInTheDocument();
    expect(screen.getByRole('img',{name:'实际温度与目标范围折线图'})).toBeInTheDocument();
    const saved=JSON.parse(localStorage.getItem(STORE_KEY)!) as Store;
    expect(saved.batches[0].samples).toHaveLength(3);
    // 越界异常自动识别（1290、1310 超出 1280±15）
    expect(await screen.findAllByText(/超出 1280 ± 15/)).toHaveLength(2);
    // 非法 CSV：时间倒退且温度非数字，带行号，不覆盖原记录
    const csvInput=csv();
    Object.defineProperty(csvInput,'value',{writable:true,value:''});
    pickFile(csvInput,new File(['时间,温度\n2026-09-01 10:00,abc\n2026-09-01 09:00,1200'],'bad.csv',{type:'text/csv'}));
    const bad=await screen.findByRole('alert');
    expect(bad.textContent).toContain('第 2 行');
    expect(bad.textContent).toContain('第 3 行');
    expect((JSON.parse(localStorage.getItem(STORE_KEY)!) as Store).batches[0].samples).toHaveLength(3);
  });
  it('异常复核可归类并保存备注',async()=>{
    localStorage.setItem(STORE_KEY,JSON.stringify(store));
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/回归批次/}));
    const csv=()=>document.querySelector('input[type=file][accept=".csv,text/csv"]') as HTMLInputElement;
    pickFile(csv(),new File(['时间,温度\n2026-09-01 08:00,1260\n2026-09-01 12:00,1290'],'x.csv',{type:'text/csv'}));
    await screen.findByText('已导入 2 个采样点');
    const status=screen.getAllByLabelText('异常状态')[0] as HTMLSelectElement;
    fireEvent.change(status,{target:{value:'equipment'}});
    const note=screen.getAllByLabelText('复核备注')[0] as HTMLInputElement;
    fireEvent.change(note,{target:{value:'热电偶松动'}});
    await waitFor(()=>{const s=JSON.parse(localStorage.getItem(STORE_KEY)!) as Store;const keys=Object.keys(s.batches[0].reviews);expect(s.batches[0].reviews[keys[0]]).toEqual({status:'equipment',note:'热电偶松动'})});
    // 重新渲染后保留
    cleanup();render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/回归批次/}));
    expect((screen.getAllByLabelText('异常状态')[0] as HTMLSelectElement).value).toBe('equipment');
    expect((screen.getAllByLabelText('复核备注')[0] as HTMLInputElement).value).toBe('热电偶松动');
  });
  it('删除批次后从列表移除',async()=>{
    const withRef:Store={...store,batches:[...store.batches,{...store.batches[0],id:'b2',name:'第二批次'}]};
    localStorage.setItem(STORE_KEY,JSON.stringify(withRef));
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/第二批次/}));
    fireEvent.click(screen.getByRole('button',{name:'删除'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:/第二批次/})).toBeNull());
    const s=JSON.parse(localStorage.getItem(STORE_KEY)!) as Store;
    expect(s.batches.map(b=>b.id)).toEqual(['b1']);
  });
});
