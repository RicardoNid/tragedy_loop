"""One scenario entity per complete source code; public/secret are document sections."""
from copy import deepcopy
import re

def scenario_code(title):
    match=re.match(r'^([A-Z]+\+?)[-－]?(\d+[A-Za-z]*(?:[-－]\d+[A-Za-z]*)*)',title)
    if not match:return None
    return match[1]+'-'+match[2].replace('－','-')

def merge_scenarios(records):
    groups={}
    for key,r in list(records.items()):
        if r['kind']=='scenarios':groups.setdefault(scenario_code(r['title']),[]).append((key,r))
    redirects={}
    for code,group in groups.items():
        assert code
        group.sort(key=lambda pair:('非公开' in pair[1]['title'],pair[1]['title']))
        root=deepcopy(group[0][1]);parts=[]
        for key,original in group:
            parts.append({'visibility':'secret' if '非公开' in original['title'] else 'public','record':deepcopy(original)})
            redirects[original['id']]=root['id'];del records[key]
        root['title']=code;root['aliases']=list(dict.fromkeys(x['record']['title'] for x in parts if x['record']['title']!=code))
        root['scenarioParts']=parts;root['relatedEntries']=[]
        root['sources']=[s for p in parts for s in p['record']['sources']]
        for key in ('body','bodySource','tables','originalTables','links','wikiStatus'):root.pop(key,None)
        if parts[0]['visibility']=='secret':
            root['fields']={'scenarioCode':code};root['provenance']={'scenarioCode':parts[0]['record']['provenance']['scenarioCode']}
        root['redirectIds']=[p['record']['id'] for p in parts if p['record']['id']!=root['id']]
        records[('scenarios',code,'')]=root
    return redirects
