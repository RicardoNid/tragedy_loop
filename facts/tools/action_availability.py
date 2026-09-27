"""Module-specific action-card availability; conditions remain attached to evidence."""
import json
from reader_metadata import MODULES

def enrich(root, records, add):
    ahr_path='sources/wiki/pages/5a4c2d8594c08b1e.json'
    ahr=json.loads((root/ahr_path).read_text())
    ahr_source={'provider':'wiki','url':ahr.get('revisionUrl') or ahr['url'],'snapshot':ahr_path}
    add('actions','友好+1',ahr_source,{},scope='剧作家额外手牌（AHR）')
    # The symbol's effect is sourced from the appendix, separately from AHR availability.
    add('actions','友好+1',{'provider':'lloyd','path':'sources/lunhui/tragedy_loop_appendix(3)(1).md'},
        {'effect':'增加1个友好指示物'},scope='剧作家额外手牌（AHR）')
    module_pages={}
    for p in (root/'sources/wiki/pages').glob('*.json'):
        d=json.loads(p.read_text())
        if d.get('requestedTitle') in MODULES.values() or d.get('requestedTitle')=='十周年规则':
            module_pages[d['requestedTitle']]=(p,d)
    for r in records.values():
        if r['kind']!='actions':continue
        side='主人公' if '主人公' in r['scope'] else '剧作家'
        r['actionSide']=side;r['availability']=[]
        r['baseAction']=r['scope'] in ('主人公手牌','剧作家手牌')
        r['authority']='官方'
        def relation(abbr,state,condition,p,d):
            r['availability'].append({'module':abbr,'state':state,'condition':condition,'source':{'provider':'wiki','url':d.get('revisionUrl') or d['url'],'snapshot':str(p.relative_to(root))}})
        for title,(p,d) in module_pages.items():
            codes=['FS+','BTX+','MZ+','MC+','HSA+','WM+'] if title=='十周年规则' else [next(k for k,v in MODULES.items() if v==title)]
            if r['title'] in ('希望+1','绝望+1'):
                # Only explicit acquisition statements are used, not mere mentions of counters.
                for line in d.get('text','').splitlines():
                    if side not in line or r['title'] not in line or '获得' not in line:continue
                    for abbr in codes:relation(abbr,'conditional',line,p,d)
            if title=='Another Horizon Revised' and ((r['title']=='不安+2' and side=='主人公') or (r['title']=='友好+1' and side=='剧作家')):
                line=next(x for x in d['text'].splitlines() if '在AHR模组中' in x)
                relation('AHR','available',line,p,d)
            if title=='Unheard Malice' and side=='剧作家' and r['title'] in ('禁止友好','密谋+2','斜向移动'):
                line=next(x for x in d['text'].splitlines() if x.startswith('怨恨的咆哮'))
                relation('UM','conditional-exclusion',line,p,d)
        r['tags']=['基础行动牌' if r['baseAction'] else '扩展行动牌',side]+list(dict.fromkeys(a['module'] for a in r['availability']))
