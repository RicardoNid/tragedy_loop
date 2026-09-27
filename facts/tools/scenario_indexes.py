"""Expose scenario index rows without pretending a missing full script was acquired."""
import json,re
from scenario_merge import scenario_code

def ingest(root,add,grid):
    titles={'官方剧本':'官方','民间剧本':'民间','剧本集剧本':'待核定','民间模组/旧模组剧本':'待核定'}
    for path in (root/'sources/wiki/pages').glob('*.json'):
        doc=json.loads(path.read_text());origin=titles.get(doc.get('requestedTitle'))
        if not origin:continue
        for ti,raw in enumerate(doc.get('tables',[])):
            table=grid(raw)
            if not table:continue
            headers=table[0]
            for ri,row in enumerate(table[1:],1):
                if not row or not re.fullmatch(r'[A-Z]+\+?[-－]?\d+[A-Za-z]*(?:[-－]\d+[A-Za-z]*)*',row[0].strip()):continue
                code=scenario_code(row[0].strip());fields={'scenarioCode':code}
                for heading,value in zip(headers[1:],row[1:]):
                    if value.strip():fields[heading.strip()]=value.strip()
                source={'provider':'wiki','url':doc.get('revisionUrl') or doc['url'],'snapshot':str(path.relative_to(root)),'table':ti+1,'row':ri+1}
                entry=add('scenarios',code,source,fields)
                if origin!='待核定':entry['authority']=origin;entry['classificationSource']=str(path.relative_to(root))
                entry['tags']=list(dict.fromkeys(entry.get('tags',[])+[doc['requestedTitle']]))
