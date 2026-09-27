"""Inventory observed lazy-loaded media without inventing URLs or fetching them."""
from pathlib import Path
from html.parser import HTMLParser
import json
R=Path(__file__).resolve().parents[1]
class Images(HTMLParser):
 def __init__(self):super().__init__();self.items=[]
 def handle_starttag(self,tag,attrs):
  if tag!='img':return
  a=dict(attrs);url=a.get('data-src') or a.get('src','')
  if url.startswith('https://'):self.items.append({'url':url,'name':a.get('data-image-name') or a.get('title') or a.get('alt','')})
media={};files={}
manifest=json.loads((R/'media/manifest.json').read_text()) if (R/'media/manifest.json').exists() else {'files':{}}
saved={x['sourcePage']:x for x in manifest['files'].values()}
for p in (R/'sources/wiki/pages').glob('*.json'):
 if p.name=='home.json':continue
 w=json.loads(p.read_text());parser=Images();parser.feed(w.get('html',''))
 for im in parser.items + [{'url': im['src'], 'name': im.get('alt', '')} for im in w.get('images', []) if im.get('src', '').startswith('https://')]:
  item=media.setdefault(im['url'],im|{'pages':[],'status':'pending'})
  if w['requestedTitle'] not in item['pages']:item['pages'].append(w['requestedTitle'])
 for link in w.get('links',[]):
  if '/wiki/File:' in link['url'] or '/wiki/%E6%96%87%E4%BB%B6:' in link['url']:
   files.setdefault(link['url'],{'url':link['url'],'status':'saved' if link['url'] in saved else 'pending','localPath':saved.get(link['url'],{}).get('path')})
(R/'sources/wiki/media-index.json').write_text(json.dumps({'observedImages':list(media.values()),'filePages':list(files.values()),'scope':'all file links in currently collected article snapshots','complete':bool(files) and all(x['status']=='saved' for x in files.values())},ensure_ascii=False,indent=2)+'\n')
print(f'{len(media)} observed image URLs, {len(files)} file detail pages; {sum(x["status"] == "saved" for x in files.values())} have local manifest records (run verify_media.py for integrity)')
