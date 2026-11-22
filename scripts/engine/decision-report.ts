import { readFileSync,writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { LiveKnowledge } from '../../packages/engine/src/runtime/knowledge.js';
import { SolutionSpace2 } from '../../packages/engine/src/solution2/space.js';
import { label,readable } from '../../apps/web/src/labels.js';
const dir='products/engine/random-cross/change-checked';
const previous=readFileSync(dir+'/reviewed-causes.html','utf8').split('<h2>待裁定</h2>')[1]!;
const targets=[...previous.matchAll(/剧本 (\d+) \/ 路径 (\d+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
const db=new DatabaseSync(dir+'/paths.sqlite',{readOnly:true});
const esc=(s:unknown)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
const table=(heads:string[],rows:unknown[][])=>'<table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
let body='';
for(const [id,path] of targets){
 const row=db.prepare('SELECT p.*,d.detail,s.setup FROM paths p JOIN scripts s ON p.script=s.id JOIN diagnoses d USING(script,path) WHERE script=? AND path=?').get(id!,path!)!;
 const {opening,before,after}=JSON.parse(String(row.evidence));
 const setup=JSON.parse(String(row.setup)), detail=JSON.parse(String(row.detail));
 const seat=(id:string)=>setup.characters.find((c:{id:string})=>c.id===id)?.character??id;
 function combination(key:string){const [y,x,roles,events]=JSON.parse(key);return [y,...x].join('＋')+'；'+roles.map((r:string,i:number)=>setup.characters[i].character+'＝'+r).join('、')+'；'+events.map(([day,event,who]:[number,string,string])=>'第'+day+'日「'+event+'」，当事人'+seat(who)).join('、');}
 const one=new LiveKnowledge(compileOfficial(setup.module),opening,4096);
 one.append(before.observations,0,before.observations.length);
 const [main,sides,roles,events]=JSON.parse(detail.id);
 const candidate={...setup,y:main,x:sides,characters:setup.characters.map((c:any,i:number)=>({...c,identity:roles[i]})),incidents:events.map(([day,name,culprit]:[number,string,string])=>({day,name,culprit,publicName:opening.incidents.find((e:any)=>e.day===day)?.name}))};
 const verdict=(v:string)=>v==='possible'?'保留':v==='excluded'?'排除':'未决';
 const priorVerdict=one.queryConfiguration(candidate,true);
 const a=one.snapshot();
 const two=new SolutionSpace2(opening),b=two.update(before), prior=two.jointKeys();
 one.append(after.observations.slice(before.observations.length),before.observations.length,after.observations.length);
 const nextVerdict=one.queryConfiguration(candidate,true);
 const a2=one.snapshot(),b2=two.update(after),next=two.jointKeys();
 const removed=prior&&next?[...prior].filter(k=>!next.has(k)):[];
 function fields(v:any,first:boolean){
  const rows:unknown[][]=[];
  for(const [id,values] of Object.entries(v.identities??{}))rows.push(['身份',seat(id),(values as string[]).join('、')]);
  for(const [day,values] of Object.entries((first?v.realIncidents:v.events)??{}))rows.push(['第'+day+'日事件','',(values as string[]).join('、')]);
  for(const [day,values] of Object.entries(v.culprits??{}))rows.push(['第'+day+'日当事人','',(values as string[]).map(seat).join('、')]);
  return table(['类别','角色','候选'],rows)+'<p>剧情组合</p><ul>'+((first?v.ruleCombinations:v.profiles)??[]).map((r:any)=>'<li>'+esc([r.y,...r.x].join('＋'))+'</li>').join('')+'</ul>';
 }
 function field(k:string,v:string){if(k==='rule')return v;const [t,id]=k.split(':');if(t==='identity')return seat(id!)+'＝'+v;if(t==='culprit')return '第'+id+'日当事人＝'+seat(v);if(t==='event')return '第'+id+'日事件＝'+v;if(t==='schedule'){const [e,c]=JSON.parse(v);return '第'+id+'日'+e+'，当事人'+seat(c);}return k+'＝'+v;}
 function relations(v:any){const r=v.candidateRelations;
  return '<ul>'+((r?.observations??[]).map((c:any)=>'<li>'+esc('公告 '+c.observation+'，至少满足一组：'+c.alternatives.map((branch:any[])=>'（'+branch.map(l=>(l.negated?'不能为':'')+field(l.key,l.value)).join(' 且 ')+'）').join(' 或 '))+'</li>').join(''))+
  (r?.pairs??[]).flatMap((p:any)=>p.excluded.map((g:any)=>'<li>'+esc('禁止同时成立：['+g.left.map((x:string)=>field(p.left,x)).join(' 或 ')+'] 与 ['+g.right.map((x:string)=>field(p.right,x)).join(' 或 ')+']')+'</li>')).join('')+'</ul>'+
  (v.relations??[]).map((r:any)=>'<p>'+esc('公告 '+r.observation+'：'+r.fact+'；'+(r.implications??[]).join('；')+'；'+(r.cases??[]).map((c:any)=>'当 '+c.when.join('且')+'，候选 '+c.alternatives.join('或')+'，限制 '+c.limits.join('且')).join('；'))+'</p>').join('')+
  (r?.partiallyDisplayed?.length?'<p>关系展示有截断，不能把未展示视为不存在。</p>':'');
 }
 const board='<p>'+esc('当前队长 '+label(before.captain)+'；Ex '+(before.ex??'不适用')+'；领地 '+(before.territory?label(before.territory):'无')+'；诅咒 '+readable(before.curses??[],before)+'；标记 '+readable(before.markers??{},before))+'</p>'+table(['角色','位置','状态','指示物'],before.characters.map((c:any)=>[c.character,label(c.area),label(c.status),Object.entries(c.counters).map(([k,v])=>label(k)+' '+v).join('，')]))+table(['版图','密谋'],Object.entries(before.boards).map(([k,v])=>[label(k),v]));
 const observations=after.observations.slice(before.observations.length);
 const diff=table(['角色','改变的字段'],after.characters.flatMap((c:any)=>{const old=before.characters.find((p:any)=>p.id===c.id);if(!old)return [[c.character,'新出现']];const d=[];for(const k of ['area','status'])if(old[k]!==c[k])d.push(label(k)+' '+label(old[k])+' → '+label(c[k]));for(const k of Object.keys(c.counters))if(old.counters[k]!==c.counters[k])d.push(label(k)+' '+old.counters[k]+' → '+c.counters[k]);return d.length?[[c.character,d.join('，')]]:[];}))+
 table(['版图字段','变化'],[...Object.keys(after.boards).filter(k=>before.boards[k]!==after.boards[k]).map(k=>[label(k)+'密谋',before.boards[k]+' → '+after.boards[k]]),...(before.ex!==after.ex?[['Ex',before.ex+' → '+after.ex]]:[])]);
 const event=observations.find((o:any)=>o.type==='incident');
 const topic=observations.some((o:any)=>o.phase==='mastermind-abilities')?'请核对这些公开变化能否由候选中的角色、剧情能力及本阶段剩余使用次数共同产生。':event?'请按候选的真实事件、当事人及身份特性核对：它能否产生本窗口的所有变化，以及未出现的强制结果？':'请核对候选在本窗口应产生哪些效果或回应，是否存在合法选择、替代或免除条件可以解释公告。';
 body+='<article id="s'+id+'"><h2>剧本 '+id+' · 路径 '+path+'</h2><p>前一完整结算点：公告 '+before.observations.length+'，第'+before.loop+'轮第'+before.day+'日 '+esc(label(before.phase))+'。本次检查点：公告 '+row.through+'，第'+after.loop+'轮第'+after.day+'日 '+esc(label(after.phase))+'。</p><h3>需要裁定的联合组合</h3><p>'+esc(combination(detail.id))+'</p>'+
 table(['求解器','前一结算点','本次检查点'],[['求解器1','重建具体组合 '+verdict(priorVerdict),'重建 '+verdict(nextVerdict)+'；历史测试 '+verdict(detail.solver1)],['求解器2',prior?(prior.has(detail.id)?'重建结果保留':'重建结果排除'):'重建未决',next?(next.has(detail.id)?'重建结果保留':'重建结果排除'):'重建未决']])+
 '<p><strong>'+esc(topic)+'</strong></p><h3>前一盘面</h3>'+board+'<h3>本次盘面变化</h3>'+diff+
 '<h3>两次完整结算点之间的公告</h3>'+table(['公告','轮／日／阶段','内容'],observations.map((o:any)=>[o.sequence,o.loop+'/'+o.day+' '+label(o.phase),label(o.type)+' '+readable(o.data,after)]))+
 '<details><summary>求解器1 · 前一解空间约束、联合关系</summary><p>符号约束视图，单项可选值不能自由拼接。未进行全量历史枚举，完整联合解数未知。</p>'+fields(a,true)+relations(a)+'</details>'+
 '<details><summary>求解器2 · 前一解空间及全部联合组合（'+(prior?.size??'未决')+'）</summary>'+fields(b,false)+relations(b)+'<ol>'+(prior?[...prior].map(k=>'<li>'+esc(combination(k))+'</li>').join(''):'未能展开完整联合组合')+'</ol></details>'+
 '<details><summary>本次缩减详情</summary><p>求解器1本次结算后的符号视图如下。精确历史搜索的全集未记录，不能由以下投影推断完整排除数量。</p>'+fields(a2,true)+relations(a2)+'<p>求解器2联合候选数 '+(prior?.size??'未决')+' → '+(next?.size??'未决')+'，删除 '+removed.length+' 项。</p><ol>'+removed.map(k=>'<li>'+esc(combination(k))+'</li>').join('')+'</ol>'+relations(b2)+'</details>'+
 '<details><summary>已有解析及待核查依据</summary><p>'+esc(row.report)+'</p></details></article>';
 console.log(id);
}
db.close();
writeFileSync(dir+'/decision-evidence.html','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>待裁定问题的盘面与解空间证据</title><style>body{font:16px/1.6 system-ui;max-width:1200px;margin:2em auto;padding:1em;color:#18333b}table{border-collapse:collapse;width:100%}td,th{border:1px solid #cbd5da;padding:.5em;text-align:left;overflow-wrap:anywhere}article{border-top:3px solid #637e8c;margin-top:3em}details{background:#f3f6f7;padding:.8em;margin:1em 0}summary{cursor:pointer}li{overflow-wrap:anywhere}</style><h1>待裁定问题 · 盘面与解空间证据</h1><p>共 '+targets.length+' 条。前一盘面和本次公告取自测试保存的公开输入。解空间视图使用当前代码重建。求解器1只保存了首次差异候选的历史判定，完整历史解集无法直接恢复，本页明确标出这项缺口。求解器2提供重建的全部联合组合。此页列出的差异组合是每条路径首次捕获的一项，不代表本窗口所有分歧组合。</p><nav>'+targets.map(([id])=>'<a href="#s'+id+'">'+id+'</a>').join(' · ')+'</nav>'+body+'</html>');
