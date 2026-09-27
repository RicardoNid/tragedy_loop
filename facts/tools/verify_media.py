from pathlib import Path
import json,re,hashlib
R=Path(__file__).resolve().parents[1]
m=json.loads((R/'media/manifest.json').read_text());checked=0;dimensionless=[]
assert not m['failures'],m['failures']
for ident,f in m['files'].items():
 p=R/f['path'];assert hashlib.sha256(p.read_bytes()).hexdigest()==f['sha256'];assert p.stat().st_size==f['bytes']
 source=json.loads((R/f['sourceRecord']).read_text());text=re.sub(r'(?<=\d),(?=\d)','',source['text'])
 dims=re.findall(r'(\d+)\s*[×x]\s*(\d+)',text);actual=re.search(r'(\d+)\s*x\s*(\d+)',f['fileInfo'])
 if p.suffix=='.ico' and not dims:
  assert p.read_bytes()[:4]==b'\x00\x00\x01\x00'
  dimensionless.append(f['title']);continue
 if not actual and p.suffix=='.webp':
  # VP8L stores width-1 and height-1 in two 14-bit fields after its 0x2f signature.
  data=p.read_bytes()
  if data[12:16]==b'VP8L' and data[20]==0x2f:
   bits=int.from_bytes(data[21:25],'little')
   actual=re.match(r'(\d+)x(\d+)',f'{(bits&0x3fff)+1}x{((bits>>14)&0x3fff)+1}')
 assert actual and dims,('Dimensions unverified',f['title'])
 assert tuple(map(int,actual.groups())) in [tuple(map(int,x)) for x in dims],(f['title'],actual.groups(),dims)
 checked+=1
print(f'Verified {checked} original media dimensions, signatures recorded by file, byte lengths and SHA256; {sum(x["bytes"] for x in m["files"].values())} bytes.')
if dimensionless:print('Hash, size and ICO signature verified; source has no dimensions:',', '.join(dimensionless))
