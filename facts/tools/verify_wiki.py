from pathlib import Path
import json
R=Path(__file__).resolve().parents[1]
c=json.loads((R/'data/catalog.json').read_text());ids=set();entries=[]
for item in c['items']:
 assert item['id'] not in ids;ids.add(item['id'])
 e=json.loads((R/item['path']).read_text());entries.append(e)
 if 'body' in e:assert (R/e['body']).is_file(),e['body']
 for s in e['sources']:
  for f in ('path','snapshot'):
   if f in s:assert (R/s[f]).is_file(),s[f]
 for f,v in e['fields'].items():
  chosen=e['provenance'][f];assert chosen in e['sources']
  assert any(x['source']==chosen and x['fields'].get(f)==v for x in e['variants'])
  rank={'wiki':0,'lloyd':1,'ricardo':2}
  candidates=[x['source'] for x in e['variants'] if f in x['fields'] and x['fields'][f] is not None and (x['fields'][f] not in ('',[],{}) or f in ('traits','max','effect','identityCounts'))]
  if candidates:assert rank[chosen['provider']]==min(rank[s['provider']] for s in candidates),(e['title'],f)
# Important rule semantics: same incident must retain module scope, all multi-row effects survive.
fs=next(e for e in entries if e['kind']=='incidents' and e['title']=='医院事故' and e['scope']=='First Steps')
assert '主人公死亡' in fs['fields']['effect']
assert fs['provenance']['effect']['provider']=='wiki'
assert {'wiki','lloyd','ricardo'} <= {s['provider'] for s in fs['sources']}
scenario=next(e for e in entries if e['kind']=='scenarios' and e['title']=='BTX-01')
public=next(p['record'] for p in scenario['scenarioParts'] if p['visibility']=='public')
secret=next(p['record'] for p in scenario['scenarioParts'] if p['visibility']=='secret')
assert len(public['fields']['schedule'])==5
assert len(secret['fields']['selectedRules'])==3
assert c['redirects'][secret['id']]==scenario['id']
assert len({e['title'] for e in entries if e['kind']=='scenarios'})==sum(e['kind']=='scenarios' for e in entries)
for e in entries:
 for part in e.get('scenarioParts',[]):
  if part['record'].get('body'):assert (R/part['record']['body']).is_file()
assert next(e for e in entries if e['title']=='HSA-27')['fields']['loops']=='无限'
ai=[e for e in entries if e['kind']=='characters' and e['title']=='AI'];assert len(ai)==1
assert set(x['provider'] for x in ai[0]['sources'])=={'wiki','lloyd'}
for name in ('临时工','临时工？'):assert sum(e['kind']=='characters' and e['title']==name for e in entries)==1
for name in ('Basic Tragedy','Basic Tragedy X','Haunted Stage','Haunted Stage Again'):
 assert any(e['kind']=='modules' and e['title']==name for e in entries)
actions=[e for e in entries if e['kind']=='actions']
assert len(actions)==21
mastermind_goodwill=next(e for e in actions if e['title']=='友好+1' and e['actionSide']=='剧作家')
assert {a['module'] for a in mastermind_goodwill['availability']}=={'AHR'}
assert len([e for e in entries if e['kind']=='faq' and '纸质 FAQ' in e.get('tags',[])])==72
for e in actions:
 for a in e['availability']:assert (R/a['source']['snapshot']).is_file()
assert any(e['kind']=='modules' and e['title']=='Basic Tragedy X Plus' for e in entries)
expected=json.loads((R/'sources/wiki/index.json').read_text())['pages'];actual={json.loads(p.read_text()).get('requestedTitle') for p in (R/'sources/wiki/pages').glob('*.json') if p.name!='home.json'}
assert c['coverage']['expected']==len(expected)
assert c['coverage']['captured']==len(actual)
assert {x['title'] for x in c['coverage']['pending']}=={x['title'] for x in expected}-actual
assert '谋杀计划' not in (R/'index.html').read_text()
print(f"Verified {len(entries)} entities, source paths, selected fields, scope, and coverage {len(actual)}/{len(expected)}; completeness not asserted.")
