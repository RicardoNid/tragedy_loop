"""Extract only explicitly labelled scenario configuration; retain prose elsewhere."""
import re
from scenario_merge import scenario_code

def scenario_fields(title, text):
    result = {}
    code = scenario_code(title)
    if not code:
        return result
    result['scenarioCode'] = code
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    match = re.search(r'(\d+|无限)轮\s*(\d+)天', text)
    if match:
        result['loops'] = int(match[1]) if match[1].isdigit() else match[1]
        result['days'] = int(match[2])
    if '非公开' not in title and match:
        # The numbered rows before the special-rules section are public incidents.
        section = text[match.end():]
        section = re.split(r'特殊规则|备注|非公开', section, maxsplit=1)[0]
        schedule = []
        for line in section.splitlines():
            row = re.fullmatch(r'\s*(\d+)\s+(.+?)\s*', line)
            if row and 1 <= int(row[1]) <= result['days']:
                schedule.append({'day': int(row[1]), 'incidentText': row[2]})
        if schedule:
            result['schedule'] = schedule
    if '非公开' in title:
        rules = []
        for line in lines:
            match = re.fullmatch(r'规则\s*([XY][12]?)\s+(.+)', line)
            if match:
                rules.append({'slot': match[1], 'name': match[2].strip()})
        if rules:
            result['selectedRules'] = rules
    return result
