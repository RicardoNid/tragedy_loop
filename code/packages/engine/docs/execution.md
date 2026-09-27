# 执行契约

## 已实现接口

- compile(data)：严格校验 JSON 定义，返回不透明、冻结的定义句柄；错误抛 DefinitionError。
- createGame(definition)：构造独立初始状态。
- legalCommands(definition, state, actor)：根据同一声明生成该操作者当前合法的 `{ruleId}` 命令，按 ID 排序。
- step(definition, state, actor, command)：返回 settled、finished、rejected 或 rule_error。

成功结果含新的 state 和带 ruleId/actor/effects 的 event。失败含稳定 code；不携带修改后的 state。调用者仍保留原状态。状态绑定定义全文，检查 phase、counter 域、revision 及终局形状。操作者身份由宿主认证，传入 actor 本身不是认证机制。

当所有前提成立但效果越界时，这是规则定义的运行时缺陷 rule_error，不是玩家非法操作。legalCommands 不通过试跑效果隐藏这类缺陷，模拟器必须能观察它。

状态转移采用副本，单次命令原子提交。每条声明的 effects 顺序具有语义；目前没有自动连锁触发，因此单步工作量由有限效果列表界定。revision 使用安全整数。

当前状态和事件都是可信诊断数据，不得直接发送给不可信玩家。没有隐式随机、系统时钟、存储或网络依赖。

## 后续执行边界

加入触发与中途选择前，必须先定义可序列化的 continuation、awaiting_choice（决策者、候选、数量）、同时结算快照、冲突裁决及终止约束。

未知顺序不能靠规则 ID 排序裁定；若纸质规则要求玩家选择，该顺序属于命令。自动结算步数上限触发时报告 rule_error，而不是 settled。事件重建状态尚未实现；当前重放从初始状态重执行命令。
