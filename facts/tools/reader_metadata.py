"""Reader classifications grounded in the captured Wiki introduction pages."""
import json
import re
from scenario_merge import scenario_code

MODULES = {
 'FS':'First Steps','BTX':'Basic Tragedy X','MZ':'Midnight Zone',
 'MC':'Mystery Circle','HSA':'Haunted Stage Again','WM':'Weird Mythology',
 'AHR':'Another Horizon Revised','LL':'Last Liar','BT':'Basic Tragedy',
 'HS':'Haunted Stage','AH':'Another Horizon','OF':'Old Fashion',
 'ST':'Supernatural Tragedy','UM':'Unheard Malice','SC':'Sin City','ELA':'Echoing Love A',
}
COMMUNITY={'Old Fashion','Supernatural Tragedy','Unheard Malice','Sin City','Echoing Love A'}

def enrich(root, records, titlekey):
    intro=json.loads((root/'sources/wiki/pages/6fadb2d7054aeea7.json').read_text())
    characters={}
    for i,table in enumerate(intro['tables']):
        for row in table:
            if row and row[0]['text'].strip() not in ('中文',''):
                characters[titlekey(row[0]['text'].strip())]='民间' if i==len(intro['tables'])-1 else '官方'
    scenario_origins={}
    for filename,authority in [('6734a0d13f91359e.json','官方'),('5eae5beed691d446.json','民间')]:
        path='sources/wiki/pages/'+filename
        listing=json.loads((root/path).read_text())
        for line in listing.get('text','').splitlines():
            match=re.match(r'^([A-Z]+\+?[-－]?\d+[A-Za-z]*)\s',line)
            if match:scenario_origins[scenario_code(line)]=(authority,path)
    for r in records.values():
        module=r['title'] if r['kind']=='modules' else r['scope']
        module=module.removesuffix(' Plus')
        if module in MODULES.values():
            r['authority']='民间' if module in COMMUNITY else '官方'
            r['classificationSource']='sources/wiki/pages/c81a236074b5a9e4.json'
        if r['kind']=='characters' and r['title'] in characters:
            r['authority']=characters[r['title']]
            r['classificationSource']='sources/wiki/pages/6fadb2d7054aeea7.json'
        if r['kind']=='scenarios':
            code=r['fields'].get('scenarioCode','')
            match=re.match(r'^([A-Z]+\+?)',code)
            prefix=match[1] if match else ''
            if code in scenario_origins:r['authority'],r['classificationSource']=scenario_origins[code]
            # Codes are the source's module abbreviation, not the scenario's authorship.
            r['module']=MODULES.get(prefix.rstrip('+'),'特殊／未指定模组')+(' Plus' if prefix.endswith('+') else '')
        tags=r.setdefault('tags',[])
        if r['kind']=='characters':tags.extend(t for t in r['fields'].get('属性',[]) if t not in tags)
        if r['kind']=='rules' and r['fields'].get('ruleType'):tags.append(r['fields']['ruleType'])
        for tag in [r.get('authority'),r.get('module')]:
            if tag and tag not in tags:tags.append(tag)


def module_registry():
    colors={'FS':'#36735c','BTX':'#347296','MZ':'#66589c','MC':'#aa6939','HSA':'#975161','WM':'#426d80','AHR':'#80599c','LL':'#8d7630','BT':'#667281','HS':'#7b707a','AH':'#727582','OF':'#7a654b','ST':'#42817c','UM':'#925970','SC':'#55725a','ELA':'#a1547a'}
    order=['FS','BTX','BTX+','MZ','MZ+','MC','MC+','HSA','HSA+','WM','WM+','AHR','LL','FS+','BT','HS','AH','OF','ST','UM','SC','ELA']
    return [{'code':code,'title':MODULES[code.rstrip('+')]+(' Plus' if code.endswith('+') else ''),'color':colors[code.rstrip('+')],'authority':'民间' if MODULES[code.rstrip('+')] in COMMUNITY else '官方','legacy':code in ('BT','HS','AH'),'order':i} for i,code in enumerate(order)]+[{'code':'特殊','title':'特殊／未指定模组','color':'#747780','authority':'待核定','legacy':False,'order':99}]
