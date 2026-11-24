import assert from 'node:assert/strict';
import test from 'node:test';
import type { Observation, GameSetup, Choice } from '../../packages/contracts/src/game.js';
import { matchesPlayerObservation } from '../../packages/engine/src/runtime/knowledge-history.js';
import { normalizeHistory } from '../../packages/engine/src/runtime/observation-history.js';

import {compileOfficial} from '../../packages/content/src/official/compile.js';
import {advance,initializeDiscussion} from '../../packages/engine/src/runtime/engine.js';
import {project} from '../../packages/engine/src/runtime/ports.js';

test('HSA 两个合法剧本在第 32 项公告前仅因未公开的跳过机会产生不同诅咒编号',()=>{
  const pack=compileOfficial('HSA');
  function replay(witch:boolean){
    const setup:GameSetup={module:'HSA',anniversary:false,y:'古墓活尸',x:[witch?'魔女遗咒':'少女大危机','怪物们的阴谋'],
      days:1,loops:1,captain:'p0',discussion:'between-loops',characters:[
        {id:'a',character:'男学生',identity:witch?'魔女':'传谣人'},
        {id:'b',character:'女学生',identity:witch?'传谣人':'关键人物'}],incidents:[{day:1,name:'诅咒活化',culprit:'school'}]};
    let state=initializeDiscussion(pack,setup).state!;
    const choices:Choice[]=[{kind:'continue'}];
    if(witch)choices.push({kind:'pass'});
    choices.push({kind:'cards',placements:[{card:'mastermind-5',target:'a'},{card:'mastermind-0',target:'shrine'},{card:'mastermind-8',target:'school'}]},
      {kind:'cards',placements:[{card:'p0-0',target:'school'}]},
      {kind:'cards',placements:[{card:'p1-2',target:'city'}]},
      {kind:'cards',placements:[{card:'p2-4',target:'b'}]},{kind:'pass'},
      {kind:'ability',owner:'b',ability:'student'});
    for(const choice of choices){
      const d=state.pending!;
      const result=advance(pack,state,d.actor,{id:'step'+state.revision,decisionId:d.id,expectedRevision:state.revision,choice});
      assert.notEqual(result.status,'rejected');state=result.state;
    }
    assert.equal(state.phase,'day-end');
    return project(state,'protagonists').observations;
  }
  const a=replay(true),b=replay(false),left=normalizeHistory(a),right=normalizeHistory(b);
  assert.equal(left.length,32);assert.equal(right.length,32);
  assert.notDeepEqual(left,right);
  for(let i=0;i<left.length;i++)assert(matchesPlayerObservation(left,right,i,a[i]!),String(i+1));
});

test('求解器1比较诅咒的公开去向；编号不包含私下行动次数，跨日期仍须是同一实体', () => {
  function reports(snapshots: string[][][]) {
    return snapshots.map(
      (pairs, i): Observation => ({
        sequence: i + 1,
        loop: 1,
        day: i + 1,
        phase: 'day-end',
        type: 'board',
        data: { curses: pairs.map(([id, target]) => ({ id, target })) },
      }),
    );
  }
  const actual = reports([
    [
      ['curse-11', 'school'],
      ['curse-12', 'school'],
    ],
    [
      ['curse-11', 'a'],
      ['curse-12', 'b'],
    ],
    [
      ['curse-11', 'hospital'],
      ['curse-12', 'shrine'],
    ],
  ]);
  const renamed = reports([
    [
      ['private-90', 'school'],
      ['private-91', 'school'],
    ],
    [
      ['private-90', 'b'],
      ['private-91', 'a'],
    ],
    [
      ['private-90', 'shrine'],
      ['private-91', 'hospital'],
    ],
  ]);
  const switched = structuredClone(renamed);
  switched[2]!.data.curses = [
    { id: 'private-90', target: 'hospital' },
    { id: 'private-91', target: 'shrine' },
  ];
  const original = normalizeHistory(actual);
  for (const [right, match] of [
    [renamed, true],
    [switched, false],
  ] as const) {
    const expected = normalizeHistory(right);
    for (let i = 0; i < 3; i++)
      assert.equal(matchesPlayerObservation(original, expected, i, actual[i]!), i < 2 || match);
  }
});
