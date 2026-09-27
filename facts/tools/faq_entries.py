"""Turn captured visible spreadsheet cells into individually traceable FAQ entries."""
import json
import re


def ingest(root, add):
    counts = {}
    for path in sorted((root / 'sources/faq-sheet').glob('*.json')):
        sheet = json.loads(path.read_text())
        section = sheet['title']
        count = 0
        for row in sheet['rows']:
            cells = [str(c).strip() for c in row['cells']]
            question, answer = cells[:2]
            if not re.match(r'^Q[：:]', question):
                if question and not answer:
                    section = question
                continue
            if not re.match(r'^A[：:]', answer):
                raise ValueError(f"Missing answer: {path.name}:{row['row']}")
            source = {'provider': 'wiki', 'url': sheet['url'],
                      'snapshot': str(path.relative_to(root)),
                      'sheet': sheet['title'], 'row': row['row'],
                      'cells': f"A{row['row']}:B{row['row']}",
                      'capturedAt': sheet['fetchedAt']}
            question = re.sub(r'^Q[：:]\s*', '', question)
            answer = re.sub(r'^A[：:]\s*', '', answer)
            entry = add('faq', question, source,
                        {'question': question, 'answer': answer},
                        scope=f"FAQ 表格 / {sheet['title']} / 第 {row['row']} 行")
            entry['tags'] = list(dict.fromkeys(['FAQ 表格', sheet['title'], section]))
            entry['authority'] = '待核定'
            count += 1
        if sheet['title'] == '答疑区':
            source={'provider':'wiki','url':sheet['url'],'snapshot':str(path.relative_to(root))}
            add('references','FAQ 表格 · 答疑说明',source,
                text='\n\n'.join('\t'.join(str(c).strip() for c in row['cells']).strip() for row in sheet['rows'] if any(str(c).strip() for c in row['cells'])))
        counts[sheet['title']] = count
    return counts


def ingest_paper(root, add):
    counts = {}
    for path in sorted((root / 'sources/paper-faq').glob('*.json')):
        document = json.loads(path.read_text())
        for row in document['entries']:
            image = 'sources/lunhui/' + row['image']
            source = {'provider': 'lloyd', 'path': image,
                      'snapshot': str(path.relative_to(root)),
                      'page': row['page'], 'questionNumber': row['number']}
            entry = add('faq', row['question'], source,
                        {'question': row['question'], 'answer': row['answer']},
                        scope=f"纸质 FAQ / {document['title']} / Q{row['number']}")
            if document['title'] == 'LL' and row['number'] == 8:
                entry['sources'].append({'provider':'lloyd','path':'sources/lunhui/9481175a05593e803795714b31ff81f1.jpg','page':14,'questionNumber':8,'note':'答案续页'})
                entry['provenance']['answer']=entry['sources'][-1]
                entry['variants'].append({'source':entry['sources'][-1],'fields':{'answer':row['answer']}})
            entry['tags'] = list(row['tags'])
            entry['authority'] = '官方'
            entry['classificationSource'] = image
            n = row['number']
            if document['title'] == '十周年':
                topic = '希望与绝望' if n <= 16 else '标志' if n <= 18 else '角色' if n <= 26 else '扩展规则'
            elif document['title'] == 'LL':
                topic = '规则' if n <= 9 else '身份与事件'
            else:
                topic = '规则' if n <= 11 else '身份' if n <= 22 else '事件'
            entry['tags'].append(topic)
        counts[document['title']] = len(document['entries'])
    return counts
