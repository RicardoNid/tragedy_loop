"""Evidence checks for the reader-feedback deliverable, including source denominators."""
from pathlib import Path
import json
import re
R=Path(__file__).resolve().parents[1]
def read(p):return json.loads(p.read_text())
catalog=read(R/'data/catalog.json')['items']
entries=[read(R/i['path']) for i in catalog]
faq=[e for e in entries if e['kind']=='faq']
assert all(e['fields'].get('question') and e['fields'].get('answer') for e in faq)
source_questions=0
for path in sorted((R/'sources/faq-sheet').glob('*.json')):
 sheet=read(path)
 for row in sheet['rows']:
  assert not any(str(x).strip() for x in row['cells'][2:]),(path,row['row'],'unparsed note columns')
  q,a=[str(x).strip() for x in row['cells'][:2]]
  if not re.match(r'^Q[：:]',q):continue
  source_questions+=1
  matching=[e for e in faq if any(s.get('snapshot')==str(path.relative_to(R)) and s.get('row')==row['row'] for s in e['sources'])]
  assert len(matching)==1,(path,row['row'])
  assert matching[0]['fields']=={'question':re.sub(r'^Q[：:]\s*','',q),'answer':re.sub(r'^A[：:]\s*','',a)}
assert source_questions==407
paper_count=0;images=set()
for path,expected in [(R/'sources/paper-faq/anniversary.json',28),(R/'sources/paper-faq/last-liar.json',18),(R/'sources/paper-faq/another-horizon-revised.json',26)]:
 doc=read(path);assert [x['number'] for x in doc['entries']]==list(range(1,expected+1))
 for row in doc['entries']:
  paper_count+=1;images.add(row['image'])
  matching=[e for e in faq if any(s.get('snapshot')==str(path.relative_to(R)) and s.get('questionNumber')==row['number'] for s in e['sources'])]
  assert len(matching)==1
  assert matching[0]['fields']['question']==row['question'] and matching[0]['fields']['answer']==row['answer']
assert paper_count==72 and len(images)==4 and len(faq)==479
for kind in ('rules','identities','incidents'):
 base={e['title']:e for e in entries if e['kind']==kind and e['scope']=='Basic Tragedy X'}
 plus={e['title']:e for e in entries if e['kind']==kind and e['scope']=='Basic Tragedy X Plus'}
 for name,e in base.items():assert plus[name]['fields']==e['fields']
assert all(e.get('module') not in (None,'待归类') for e in entries if e['kind']=='scenarios')
for e in entries:
 if e['kind']=='actions' and not e['baseAction']:assert e['availability'],e['title']
 if 'classificationSource' in e:assert (R/e['classificationSource']).is_file()
# The four-tab UI audit belongs to feedback 2; feedback 3 moves globals above three tabs.
assert read(R/'research/module-live-layout-check.json')['tablesIdentical'] is True
print('Verified all 407 spreadsheet QAs, 72 scanned QAs, BTX+ inheritance, module assignments, action evidence, and source layout evidence.')
