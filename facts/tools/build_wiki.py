"""Build the local wiki's data; the HTML shell never contains rule content."""
from pathlib import Path
from html.parser import HTMLParser
import json, re, hashlib
from scenario_fields import scenario_fields
from faq_entries import ingest as ingest_faq, ingest_paper
from scenario_indexes import ingest as ingest_scenario_indexes
from scenario_merge import merge_scenarios
from reader_metadata import enrich, module_registry
from action_availability import enrich as enrich_actions
ROOT=Path(__file__).resolve().parents[1]
def load(p): return json.loads(p.read_text())
def dump(p,v):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def key(s): return re.sub(r'\s+','',s).strip()
def sid(*s):return hashlib.sha256('|'.join(s).encode()).hexdigest()[:16]
def grid(rows):
 out=[];occupied={}
 for y,row in enumerate(rows):
  line={x:v for (yy,x),v in occupied.items() if yy==y};x=0
  for c in row:
   while x in line:x+=1
   for dy in range(c.get('rowspan',1)):
    for dx in range(c.get('colspan',1)):
     occupied[y+dy,x+dx]=c['text'];
     if dy==0:line[x+dx]=c['text']
   x+=c.get('colspan',1)
  out.append([line.get(i,'') for i in range(max(line,default=-1)+1)])
 return out
records={}; wiki_records=[]
media_manifest=load(ROOT/'media/manifest.json') if (ROOT/'media/manifest.json').exists() else {'files':{}}
media_by_page={m['sourcePage']:m for m in media_manifest['files'].values()}
ALIASES={'A.I.':'AI','女學生':'女学生','女子学生':'女学生','男學生':'男学生','男子学生':'男学生','班長':'班长','從者':'从者','情報商':'情报商','教師':'教师','職員':'职员','臨時工':'临时工','臨時工？':'临时工？','護士':'护士','軍人':'军人','神靈':'神灵','異界人':'异界人','媒體人':'媒体人','學者':'学者','黑貓':'黑猫','醫生':'医生','轉校生':'转校生','鑑別員':'鉴别员'}
def titlekey(s):return ALIASES.get(s,s)
def add(kind,title,source,fields=None,text='',scope='',tables=None):
 k=(kind,titlekey(title),scope);r=records.setdefault(k,{'id':sid(*k),'title':titlekey(title),'kind':kind,'scope':scope,'aliases':[],'fields':{},'provenance':{},'sources':[],'variants':[]})
 if title!=r['title'] and title not in r['aliases']:r['aliases'].append(title)
 r['sources'].append(source);r['variants'].append({'source':source,'fields':fields or {}})
 for f,v in (fields or {}).items():
  if f not in r['fields'] and (v is not None and (v not in ('',[],{}) or f in ('traits','max','effect','identityCounts'))):r['fields'][f]=v;r['provenance'][f]=source
 if text.strip() and 'body' not in r:
  path='text/'+kind+'/'+r['id']+'.txt';(ROOT/path).parent.mkdir(parents=True,exist_ok=True);(ROOT/path).write_text(text);r['body']=path;r['bodySource']=source
 if tables and 'tables' not in r:r['tables']=tables
 return r
index=load(ROOT/'sources/wiki/index.json')
for p in sorted((ROOT/'sources/wiki/pages').glob('*.json')):
 if p.name=='home.json':continue
 w=load(p);wiki_records.append(w);title=w['requestedTitle'];text=w.get('text','');tables=[grid(x) for x in w.get('tables',[])];src={'provider':'wiki','url':w.get('revisionUrl') or w['url'],'snapshot':str(p.relative_to(ROOT)),'capturedAt':w.get('fetchedAt')}
 fields={};kind='articles'
 if re.search(r'【角色名】',text):
  kind='characters'
  labels='角色名|初始区域|禁行区域|不安限度|属性|特性|友好能力|感想'
  for m in re.finditer(r'【('+labels+r')】\s*(.*?)(?=【(?:'+labels+r')】|\Z)',text,re.S):fields[m[1]]=m[2].strip()
  fields.pop('感想',None)
 elif title.startswith('FAQ'):kind='references'
 elif re.match(r'^[A-Z]+\+?[-－]?\d',title):kind='scenarios'
 elif tables and ('特殊规则如下' in text[:100] or any('身份特性' in key(''.join(row)) for t in tables for row in t)):kind='modules'
 elif '剧本' in title:kind='references'
 elif '术语' in title:kind='glossary'
 if kind=='scenarios':fields['visibility']='secret' if '非公开' in title else 'public-or-index'
 if kind=='characters':
  fields['属性']=re.split(r'[・·，,、\s]+',fields.get('属性','').strip()) if fields.get('属性') else []
  if '友好能力' in fields:
   abilities=[]
   for part in re.split(r'(?=[（(]友好)',fields['友好能力']):
    if not part.strip():continue
    ability={'text':part.strip()}
    match=re.match(r'[（(]友好\s*(\d+)([^）)]*)[）)]',part)
    if match:
     ability['threshold']=int(match[1]);ability['limitText']=match[2].strip()
     if '1L1' in match[2]:ability['oncePerLoop']=True
    abilities.append(ability)
   fields['友好能力']=abilities
 if kind=='modules':
  fields['special']=re.sub(r'<[^>]+>',' ',w.get('html','').split('<table',1)[0]).strip()
 r=add(kind,title,src,fields,text,tables=tables)
 r['wikiTitle']=title
 r['originalTables']=w.get('tables',[])
 r['wikiStatus']='empty-source' if not text.strip() else 'captured';r['links']=w.get('links',[]);r['images']=w.get('images',[])
 r['media']=[media_by_page[link['url']] for link in r['links'] if link['url'] in media_by_page]
 if kind=='faq':
  questions=[]
  for t in tables:
   for row in t:
    if len(row)>=2 and re.match(r'^Q[：:]',row[0].strip()):
     questions.append({'question':re.sub(r'^Q[：:]\s*','',row[0].strip()),'answer':re.sub(r'^A[：:]\s*','',row[1].strip())})
  if questions:r['fields']['questions']=questions;r['provenance']['questions']=src;r['variants'][-1]['fields']['questions']=questions
 if kind=='scenarios':
  specs=scenario_fields(title,text)
  if specs:
   r['fields'].update(specs);r['provenance'].update({f:src for f in specs});r['variants'][-1]['fields'].update(specs)

 if kind=='modules':
  children={}; special_column_values=[]
  for t in tables:
   if t and any(key(x)=='特殊规则' for x in t[0]):
    column=next(i for i,x in enumerate(t[0]) if key(x)=='特殊规则')
    special_column_values=list(dict.fromkeys(row[column].strip() for row in t[1:] if column<len(row) and row[column].strip()))
  if special_column_values:
   r['fields']['tableSpecial']=special_column_values;r['provenance']['tableSpecial']=src;r['variants'][-1]['fields']['tableSpecial']=special_column_values
  def child(kind,name,fields):
   c=children.setdefault((kind,name),{})
   for f,v in fields.items():
    if f in ('effect','abilities','traits'):
     values=v if isinstance(v,list) else [v]
     c.setdefault(f,[])
     for value in values:
      if value and value not in c[f]:c[f].append(value)
    else:c[f]=v
  for t in tables:
   role_headers=[]; effect_col=None; current_rule_type='Y'; mode='rules'
   for row in t:
    norms=[key(c) for c in row]
    if '附加规则' in norms or '追加规则' in norms:
     role_headers=norms;effect_col=next(i for i,v in enumerate(norms) if v in ('附加规则','追加规则'));continue
    if len(row)<3 or not key(row[1]) or key(row[1]) in ('身份','事件名称','事件名'):continue
    if norms[0]=='身份':mode='identities'
    elif norms[0]=='事件':mode='incidents'
    explicit={'X':'X','Y':'Y','规则X':'X','规则Y':'Y','主线':'Y','支线':'X','主':'Y','支':'X'}.get(norms[0])
    if explicit:current_rule_type=explicit
    rule_type=current_rule_type if mode=='rules' and role_headers else None
    effect=row[effect_col] if effect_col is not None and effect_col<len(row) else row[-1]
    if rule_type:
     fs={'ruleType':rule_type,'identityCounts':{role_headers[i]:row[i] for i in range(2,min(len(row),effect_col)) if row[i].strip() and role_headers[i] not in ('规则名','剧本','')},'effect':effect}
     child('rules',key(row[1]),fs)
    elif norms[0]=='身份':
     child('identities',key(row[1]),{'max':row[2], 'traits':row[3] if len(row)>3 else '', 'abilities':[effect]})
    elif norms[0]=='事件':child('incidents',key(row[1]),{'effect':effect})
  for (ck,cn),fields in children.items():
   for field in ('effect','traits'):
    if field in fields:fields[field]='\n'.join(fields[field])
   add(ck,cn,src,fields,scope=r['title'])
# Existing generated content is used as a parsed view of the Lloyd appendix, not a new authority.
local=load(ROOT/'sources/lunhui/appendix-data.json')
src={'provider':'lloyd','path':'sources/lunhui/tragedy_loop_appendix(3)(1).md'}
for m in local['modules']:
 add('modules',m['name'],src,{'special':m['special']})
 for ru in m['rules']:add('rules',ru['name'],src,{'ruleType':ru['kind'].upper(),'identityCounts':{r['name']:r['count'] for r in ru['roles']},'effect':'\n'.join(ru['text'])},scope=m['name'])
 for i in m['identities']:add('identities',i['name'],src,{k:v for k,v in i.items() if k!='name'},scope=m['name'])
 for i in m['incidents']:add('incidents',i['name'],src,{'effect':'\n'.join(i['text'])},scope=m['name'])
headers=['角色名','特性','属性1','属性2','初始区域','禁行区域','友好能力1','友好能力2','友好能力3','友好能力4','不安限度','友好能力1所需友好度','友好能力2所需友好度','友好能力3所需友好度','友好能力4所需友好度','能力1一轮回一次','能力2一轮回一次']
for row in local['characters']:
 fs={'特性':row[1],'属性':[x for x in row[2:4] if x], '初始区域':row[4],'禁行区域':row[5],'不安限度':row[10], '友好能力':[{'text':row[6+i],'threshold':row[11+i],'oncePerLoop':row[15+i] if i<2 else None} for i in range(4) if row[6+i]]}
 add('characters',row[0],src,fs)
# Action cards are independent scoped entities, not executable engine components.
for line in (ROOT/src['path']).read_text().split('## 附录B',1)[0].splitlines():
 if not line.startswith('|'):continue
 row=[x.strip() for x in line.strip('| ').split('|')]
 if len(row)==5 and ('手牌' in row[0]):add('actions',row[1],src,{'effect':row[2].replace('<br>','\n'),'count':row[3],'oncePerLoop':row[4]},scope=row[0])
# Ricardo's review status remains source metadata; draft values do not become official rulings.
ricpath='sources/ricardo/reference/character-cards/cards.md'
for line in (ROOT/ricpath).read_text().splitlines():
 if not line.startswith('|'):continue
 row=[x.strip() for x in line.strip('|').split('|')]
 if len(row)<11 or row[0]!='first-steps':continue
 add('characters',row[3],{'provider':'ricardo','path':ricpath,'status':'draft_needs_human_review'}, {'不安限度':row[4],'初始区域':row[6],'禁行区域':row[7],'属性':re.split(r'[、，・· ]+',row[8]),'友好能力':[row[9]]})
ricpath='working/ricardo/modules/first-steps.json'
rm=load(ROOT/ricpath);rs={'provider':'ricardo','path':ricpath,'status':rm['review_status']}
add('modules',rm['name'],rs,{'mastermind_hand':rm.get('mastermind_hand')})
for ru in rm['rules']:add('rules',ru['name'],rs,{'ruleType':ru.get('category'),'effect':ru.get('draft_effect')},scope=rm['name'])

# Merge the populated Ricardo review tables into scoped entities as lowest-priority candidates.
for p in sorted((ROOT/'sources/ricardo/reference/module/modules').glob('*.md')):
 content=p.read_text();module=content.splitlines()[0].removeprefix('# ').split(' - ')[0]
 source={'provider':'ricardo','path':str(p.relative_to(ROOT)),'status':'draft_needs_human_review'}
 section=''
 for line in content.splitlines():
  if line.startswith('## '):section=line[3:].strip()
  if not line.startswith('|'):continue
  row=[x.strip() for x in line.strip('| ').split('|')]
  if not row or all(re.fullmatch(r'[-: ]*',x) for x in row):continue
  if section=='规则表' and len(row)==4 and row[0] in ('规则X','规则Y'):
   fields={'ruleType':row[0][-1],'effect':row[3]}
   if row[2]:fields['identityConfigurationText']=row[2]
   add('rules',row[1],source,fields,scope=module)
  elif section=='身份表' and len(row)==4 and row[0]!='身份名':
   add('identities',row[0],source,{'max':row[1],'traits':row[2],'abilities':[row[3]] if row[3] else []},scope=module)
  elif section=='事件表' and len(row)==2 and row[0]!='事件名':
   add('incidents',row[0],source,{'effect':row[1]},scope=module)

# Long prose remains separately addressable. Parsed source tables belong in the source library.
source_inventory=[]
for provider,folder in [('lloyd','sources/lunhui'),('ricardo','sources/ricardo'),('ricardo','working/ricardo')]:
 for p in sorted((ROOT/folder).rglob('*')):
  if not p.is_file() or p.name=='.gitkeep':continue
  rel=str(p.relative_to(ROOT));inventory={'path':rel,'provider':provider,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
  source_inventory.append(inventory)
  if any(x in p.name for x in ('开发框架','development')):
   inventory['treatment']='engineering-source-only';continue
  if p.suffix not in ('.md','.txt','.json'):
   inventory['treatment']='source-attachment'
   if p.suffix.lower() in ('.jpg','.jpeg','.png','.webp'):
    media_entry=add('media',p.name,{'provider':provider,'path':rel},{'bytes':p.stat().st_size,'sha256':inventory['sha256']})
    media_entry['media']=[{'title':p.name,'path':rel,'sourcePage':rel}]
    inventory['entryId']=media_entry['id']
   continue
  if p.suffix=='.json':
   inventory['treatment']='structured-source';continue
  text=p.read_text();heading=next((s.lstrip('# ').strip() for s in text.splitlines() if s.startswith('# ')),p.stem)
  title={'主人公之书(3)(1)':'主人公之书','tragedy_loop_game_rules(3)(1)':'游戏基础规则','tragedy_loop_appendix(3)(1)':'规则附录原文'}.get(p.stem,heading)
  kind='references'
  if title in ('主人公之书','游戏基础规则'):kind='articles'
  elif 'FAQ' in title or '裁定' in title:kind='references'
  source={'provider':provider,'path':rel}
  if provider=='ricardo':source['status']='draft_needs_human_review'
  entry=add(kind,title,source,text=text)
  inventory.update(treatment='reader-entry',entryId=entry['id'])
for media in media_manifest['files'].values():
 source={'provider':'wiki','url':media['sourcePage'],'snapshot':media['sourceRecord']}
 item=add('media',media['title'],source,{'bytes':media['bytes'],'sha256':media['sha256']})
 item['media']=[media]
# A separate reader module composes the base with the sourced anniversary overlay.
anniversary=load(ROOT/'sources/wiki/pages/64edfee587f8aad7.json')
anniversary_source={'provider':'wiki','url':anniversary.get('revisionUrl') or anniversary['url'],'snapshot':'sources/wiki/pages/64edfee587f8aad7.json'}
plus=add('modules','Basic Tragedy X Plus',anniversary_source,{'special':anniversary['text']},scope='')
plus['aliases']=['BTX+','BTX Plus'];plus['authority']='官方';plus['tags']=['BTX+','十周年']
plus['compositionDecision']='decisions/0002-reader-feedback.md'
# The anniversary sheet mixes selectable rows and global instructions. Render globals above tabs.
plus['globalSpecial']='\n\n'.join(line for line in anniversary['text'].splitlines() if line.strip() and not line.startswith(('超越世界线\t','希望之光\t','绝望之暗\t','因果残片\t','【强制：轮回开始时】')))

for original in list(records.values()):
 if original['scope']=='Basic Tragedy X' and original['kind'] in ('rules','identities','incidents'):
  copied=add(original['kind'],original['title'],original['sources'][0],original['fields'],scope=plus['title'])
  copied['provenance']=dict(original['provenance']);copied['sources']=list(original['sources']);copied['inheritedFrom']=original['id'];copied['authority']='官方'
for table_number,kind in [(0,'rules'),(1,'incidents')]:
 for row in anniversary['tables'][table_number]:
  cells=[c['text'] for c in row]
  fields={'effect':cells[-1]}
  if kind=='rules':fields.update(ruleType='X',identityConfigurationText=cells[1])
  add(kind,cells[0],anniversary_source,fields,scope=plus['title'])
identity_table=anniversary['tables'][2]
add('identities',identity_table[0][0]['text'],anniversary_source,{'abilities':[row[-1]['text'] for row in identity_table]},scope=plus['title'])
faq_counts=ingest_faq(ROOT,add)
dump(ROOT/'data/faq-extraction.json',{'sheets':faq_counts,'total':sum(faq_counts.values()),'authority':'来源包含整理与推断，不将整张表一概标为官方裁定。'})
paper_counts=ingest_paper(ROOT,add)
dump(ROOT/'data/paper-faq-extraction.json',paper_counts)
ingest_scenario_indexes(ROOT,add,grid)
enrich_actions(ROOT,records,add)
enrich(ROOT,records,titlekey)
redirects=merge_scenarios(records)
items=[]
for r in records.values():
 r['conflicts']=[{'field':f,'selected':r['fields'].get(f),'candidate':v,'source':variant['source']} for variant in r['variants'] for f,v in variant['fields'].items() if v not in (None,'',[],{}) and f in r['fields'] and v!=r['fields'][f]]
 if r['kind']=='scenarios' and r['fields'].get('scenarioCode'):
  r['relatedEntries']=[{'id':other['id'],'title':other['title'],'visibility':other['fields'].get('visibility')} for other in records.values() if other['kind']=='scenarios' and other['id']!=r['id'] and other['fields'].get('scenarioCode')==r['fields']['scenarioCode']]
 entry_path=f"data/{r['kind']}/{r['id']}.json"
 dump(ROOT/entry_path,r);items.append({k:r[k] for k in ('id','title','kind','scope','aliases')}|{'providers':list(dict.fromkeys(s['provider'] for s in r['sources'])),'hasBody':'body' in r,'fieldCount':len(r['fields']),'wikiTitle':r.get('wikiTitle'),'path':entry_path,'availability':r.get('availability',[]),'actionSide':r.get('actionSide'),'baseAction':r.get('baseAction'),'question':r['fields'].get('question'),'answer':r['fields'].get('answer'),'faqSources':r['sources'] if r['kind']=='faq' else [],'module':r.get('module'),'tags':r.get('tags',[]),'authority':r.get('authority','待核定'),'thumbnail':next((m['path'] for m in r.get('media',[]) if m.get('path')),None),'searchText':' '.join([r['title'],r['scope'],json.dumps(r['fields'],ensure_ascii=False)])})
# Prune obsolete generated entities only; original sources are never removed.
active_paths={r['path'] for r in items}
active_text={r['body'] for r in records.values() if 'body' in r}
active_text.update(p['record']['body'] for r in records.values() for p in r.get('scenarioParts',[]) if 'body' in p['record'])
for path in (ROOT/'data').glob('*/*.json'):
 if str(path.relative_to(ROOT)) not in active_paths:path.unlink()
for path in (ROOT/'text').rglob('*.txt'):
 if str(path.relative_to(ROOT)) not in active_text:path.unlink()
seen={w['requestedTitle'] for w in wiki_records}
coverage={'indexComplete':index['complete'],'expected':len(index['pages']),'captured':len(seen),'empty':[w['requestedTitle'] for w in wiki_records if not w.get('text','').strip()],'pending':[e for e in index['pages'] if e['title'] not in seen],'complete':len(seen)==len(index['pages'])}
dump(ROOT/'data/catalog.json',{'schemaVersion':1,'priority':['wiki','lloyd','ricardo'],'items':items,'redirects':redirects,'modules':module_registry(),'coverage':coverage})
dump(ROOT/'data/coverage.json',coverage)
for folder in ('sources/faq-sheet','sources/paper-faq'):
 for p in sorted((ROOT/folder).glob('*.json')):
  source_inventory.append({'path':str(p.relative_to(ROOT)),'provider':'wiki' if 'faq-sheet' in folder else 'lloyd','sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'treatment':'faq-source'})
dump(ROOT/'data/source-inventory.json',source_inventory)
print(f"Built {len(items)} entries; Wiki {len(seen)}/{len(index['pages'])}")
# Static servers may cache assets after a reload; content hashes select the current reader.
shell=(ROOT/'index.html').read_text()
for asset in ('wiki.js','wiki.css'):
 digest=hashlib.sha256((ROOT/'assets'/asset).read_bytes()).hexdigest()[:12]
 shell=re.sub(r'assets/'+re.escape(asset)+r'(?:\?v=[a-zA-Z0-9-]+)?',f'assets/{asset}?v={digest}',shell)
(ROOT/'index.html').write_text(shell)
