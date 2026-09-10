import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import App from './App';
import {initialStore,isStore,STORE_KEY} from './data';
import type {Batch,Store} from './types';

const wallStamp=(start:string,min:number)=>{const d=new Date(Date.parse(start)+min*60000);const p=(v:number)=>String(v).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`};
const mk=(id:string,start='2026-09-01T08:00',ref?:string):Batch=>({...(ref?{referenceBatchId:ref}:{}),id,name:id,kiln:'K1',recipeId:'r1',start,notes:'',samples:[{time:start,temperature:20},{time:wallStamp(start,10),temperature:90}],reviews:{}});

beforeEach(()=>{localStorage.clear();vi.stubGlobal('confirm',()=>true)});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('数据校验与迁移',()=>{
  it('旧本地数据缺少 referenceBatchId 时仍通过校验并按未对比加载',()=>{
    const legacy={version:1,gapMinutes:30,recipes:[{id:'r1',name:'x',target:100,tolerance:5,duration:60}],batches:[{id:'b1',name:'b',kiln:'K',recipeId:'r1',start:'2026-09-01T00:00',notes:'',samples:[{time:'2026-09-01T00:00',temperature:1},{time:'2026-09-01T00:05',temperature:2}],reviews:{}}]};
    expect(isStore(legacy)).toBe(true);
    localStorage.setItem(STORE_KEY,JSON.stringify(legacy));
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/^b/}));
    expect(screen.getByLabelText('参考批次').value).toBe('');
    expect(screen.queryByTestId('compare-summary')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('初始示例数据（无参考字段）可直接加载',()=>{
    expect(isStore(initialStore)).toBe(true);
    render(<App/>);
    expect(screen.getByText('九月青瓷 A 批')).toBeInTheDocument();
  });
  it('悬空参考编号（批次被删除）加载为具体错误而非崩溃，且旧摘要不显示',()=>{
    const store:Store={version:1,gapMinutes:45,recipes:[{id:'r1',name:'x',target:100,tolerance:5,duration:60}],batches:[mk('cur','2026-09-01T08:00','gone')]};
    localStorage.setItem(STORE_KEY,JSON.stringify(store));
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/^cur/}));
    expect(screen.getByLabelText('参考批次').value).toBe('gone');
    expect(screen.getByRole('alert').textContent).toContain('参考批次已被删除');
    expect(screen.queryByTestId('compare-summary')).toBeNull();
    expect(screen.queryByTestId('reference-line')).toBeNull();
  });
  it('导出再导入后恢复参考批次选择',async()=>{
    const readText=(blob:Blob)=>new Promise<string>(res=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.readAsText(blob)});
    let exported='';
    vi.stubGlobal('URL',{...URL,createObjectURL:(blob:Blob)=>{readText(blob).then(t=>{exported=t});return 'blob:x'},revokeObjectURL:()=>{}});
    HTMLAnchorElement.prototype.click=function(){(this as any).dispatchEvent(new Event('click'))};
    const store:Store={version:1,gapMinutes:45,recipes:[{id:'r1',name:'青瓷',target:100,tolerance:5,duration:60}],batches:[mk('cur'),mk('ref','2026-08-01T08:00')]};
    localStorage.setItem(STORE_KEY,JSON.stringify(store));
    render(<App/>);
    // 选择参考批次
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/^cur/}));
    fireEvent.change(screen.getByLabelText('参考批次'),{target:{value:'ref'}});
    await screen.findByTestId('compare-summary');
    // 导出
    fireEvent.click(screen.getByRole('button',{name:'数据与设置'}));
    fireEvent.click(screen.getByRole('button',{name:'导出 JSON'}));
    await waitFor(()=>expect(exported).toContain('referenceBatchId'));
    const backup=JSON.parse(exported) as Store;
    expect(backup.batches.find(b=>b.id==='cur')!.referenceBatchId).toBe('ref');
    // 清空本地后重新挂载并导入备份
    localStorage.clear();cleanup();
    render(<App/>);
    const file=new File([exported],'backup.json',{type:'application/json'});
    fireEvent.click(screen.getByRole('button',{name:'数据与设置'}));
    const input=document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input,{target:{files:[file]}});
    await screen.findByText('备份导入成功');
    fireEvent.click(screen.getByRole('button',{name:'烧成批次'}));
    fireEvent.click(screen.getByRole('button',{name:/^cur/}));
    expect((screen.getByLabelText('参考批次') as HTMLSelectElement).value).toBe('ref');
    expect(await screen.findByTestId('compare-summary')).toBeInTheDocument();
    expect(screen.getByTestId('max-minute').textContent).toBe('0');
    expect(JSON.parse(localStorage.getItem(STORE_KEY)!).batches.find((b:Batch)=>b.id==='cur').referenceBatchId).toBe('ref');
  });
  it('导入非法备份不会覆盖当前数据',async()=>{
    const store:Store={version:1,gapMinutes:45,recipes:[],batches:[]};
    localStorage.setItem(STORE_KEY,JSON.stringify(store));
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'数据与设置'}));
    const input=document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input,{target:{files:[new File(['{bad json'],'x.json',{type:'application/json'})]}});
    expect(await screen.findByText('备份格式无效，当前数据未更改')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORE_KEY)!)).toEqual(store);
  });
});
