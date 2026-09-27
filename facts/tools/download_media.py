"""Save only original URLs observed on Wiki file-detail pages; one request at a time."""
from pathlib import Path
import hashlib,json,subprocess,time
from urllib.parse import urlparse
R=Path(__file__).resolve().parents[1];out=R/'media/wiki';out.mkdir(parents=True,exist_ok=True)
manifest_path=R/'media/manifest.json';manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {'files':{},'failures':{}}
def save():manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
for p in sorted((R/'sources/wiki/files').glob('*.json')):
 info=json.loads(p.read_text());identifier=info['id'];old=manifest['files'].get(identifier)
 if old and (R/old['path']).is_file() and hashlib.sha256((R/old['path']).read_bytes()).hexdigest()==old['sha256']:continue
 url=info.get('downloadUrl') or info['originalUrl'];parsed=urlparse(url)
 if parsed.scheme!='https' or parsed.hostname!='static.wikia.nocookie.net':raise ValueError('Unexpected original host')
 tmp=out/(identifier+'.partial')
 result=subprocess.run(['get-dep','curl','--location','--max-time','30','--silent','--show-error','--output',str(tmp),'--write-out','%{http_code}',url],capture_output=True,text=True)
 if result.returncode or result.stdout.strip()!='200':
  manifest['failures'][identifier]={'url':url,'httpStatus':result.stdout.strip(),'error':result.stderr[-300:]};save();raise SystemExit('Download stopped; retained failure for '+info['title'])
 data=tmp.read_bytes()
 ext='png' if data.startswith(b'\x89PNG\r\n') else 'jpg' if data.startswith(b'\xff\xd8\xff') else 'webp' if data[:4]==b'RIFF' and data[8:12]==b'WEBP' else 'gif' if data[:3]==b'GIF' else 'ico' if data[:4]==b'\x00\x00\x01\x00' else None
 if not ext:
  manifest['failures'][identifier]={'url':url,'error':'Unrecognized image signature'};save();raise SystemExit('Unexpected media type '+info['title'])
 dest=out/(identifier+'.'+ext);tmp.replace(dest)
 file_info=subprocess.run(['file','--brief',str(dest)],capture_output=True,text=True,check=True).stdout.strip()
 manifest['files'][identifier]={'title':info['title'],'sourcePage':info['requestedUrl'],'originalUrl':url,'path':str(dest.relative_to(R)),'sourceRecord':str(p.relative_to(R)),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'fileInfo':file_info,'license':info.get('license',[])}
 manifest['failures'].pop(identifier,None);save();print('Saved '+info['title']+' '+str(len(data))+' bytes',flush=True);time.sleep(1.5)
print('Verified saved media records:',len(manifest['files']))
