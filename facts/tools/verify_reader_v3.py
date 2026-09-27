"""Check that scenario consolidation loses neither source pages nor secret bodies."""
import json,re
from pathlib import Path
from scenario_merge import scenario_code
R=Path(__file__).resolve().parents[1]
c=json.loads((R/'data/catalog.json').read_text())
scenarios=[json.loads((R/i['path']).read_text()) for i in c['items'] if i['kind']=='scenarios']
originals={d['requestedTitle']:d for p in (R/'sources/wiki/pages').glob('*.json') if (d:=json.loads(p.read_text())).get('requestedTitle') and scenario_code(d['requestedTitle'])}
parts=[p['record'] for s in scenarios for p in s['scenarioParts']]
expected_codes={scenario_code(t) for t in originals}
for path in (R/'sources/wiki/pages').glob('*.json'):
 doc=json.loads(path.read_text())
 if doc.get('requestedTitle') not in ('官方剧本','民间剧本','剧本集剧本','民间模组/旧模组剧本'):continue
 for table in doc.get('tables',[]):
  for row in table:
   if row and re.fullmatch(r'[A-Z]+\+?[-－]?\d+[A-Za-z]*(?:[-－]\d+[A-Za-z]*)*',row[0]['text'].strip()):expected_codes.add(scenario_code(row[0]['text'].strip()))
assert {s['title'] for s in scenarios}==expected_codes
assert {p['wikiTitle'] for p in parts if p.get('wikiTitle')}==set(originals)
assert len([p for p in parts if p.get('wikiTitle')])==len(originals)
for p in parts:
 if not p.get('wikiTitle'):continue
 original=originals[p['wikiTitle']]
 if original.get('text','').strip():assert (R/p['body']).read_text()==original['text']
 assert c['redirects'][p['id']] in {s['id'] for s in scenarios}
assert scenario_code('AHR-1-2非公开信息表')=='AHR-1-2'
assert scenario_code('AHR-1-3')=='AHR-1-3'
assert scenario_code('MZ+02')=='MZ+-02'
assert scenario_code('FS-01G')!='FS-01'
assert all(i['question'] and i['answer'] and i['faqSources'] for i in c['items'] if i['kind']=='faq')
assert len(c['modules'])==len({m['code'] for m in c['modules']})
print(f'Verified {len(originals)} scenario source pages preserved in {len(scenarios)} unique scenarios; every body and old ID retained; full numbered suffixes kept.')
