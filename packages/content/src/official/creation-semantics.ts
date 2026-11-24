import type { Module } from '../../../contracts/src/game.js';
import type {
  RulePack,
  IdentityTraits,
  IncidentDefinition,
} from '../../../engine/src/runtime/model.js';

/** Solver 1 declarations for its forward validator and reverse domain builder. */
export function setupSemantics(module: Module): RulePack['setupRules'] {
  return {
    xSlots: module === 'FS' ? 1 : 2,
    optionalQuota: '暴徒',
    attribute: {
      plot: '和我签订契约吧！',
      identity: '关键人物',
      attribute: '少女',
      except: '局外人',
    },
    attributes: [
      { plot: '少女大危机', identities: ['关键人物'], attribute: '少女', except: '局外人' },
      { plot: '男子汉的战争', identities: ['忍者'], attribute: '男性', except: '局外人' },
      { plot: '爱丽丝梦游仙境', identities: ['爱丽丝'], attribute: '少女', except: '局外人' },
      {
        plot: '叛逆的世界',
        identities: ['关键人物', '因果残片'],
        attribute: '少女',
        except: '局外人',
      },
    ],
  };
}
export const identityConstruction: Record<string, Pick<IdentityTraits, 'culpritRequirement'>> = {
  强迫症: { culpritRequirement: 'required' },
  愚者: { culpritRequirement: 'required' },
  双胞胎: { culpritRequirement: 'required' },
  祭品: { culpritRequirement: 'required' },
  怪杰: { culpritRequirement: 'required' },
  侦探: { culpritRequirement: 'forbidden' },
};
export const ordinaryIncidentIdentities: Record<
  string,
  Pick<IdentityTraits, 'ordinaryIncidentTrigger'>
> = Object.fromEntries(
  [
    '关键人物',
    '杀手',
    '主谋',
    '邪教徒',
    '亲友',
    '暴徒',
    '杀人狂',
    '传谣人',
    '平民',
    '魔女',
    '时间旅者',
    '心上人',
    '求爱者',
    '不安定因子',
    '因果残片',
  ].map((name) => [name, { ordinaryIncidentTrigger: true as const }]),
);
export const crowdIncidentSemantics: Record<string, Pick<IncidentDefinition, 'crowdThreshold'>> = {
  疯狂之夜: { crowdThreshold: 0 },
  诅咒活化: { crowdThreshold: 1 },
  污秽溢出: { crowdThreshold: 2 },
  死者默示录: { crowdThreshold: 2 },
};
