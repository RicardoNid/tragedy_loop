# 验证契约

## 当前模拟器

simulate 使用独立带种子 PRNG，在当前 phase 的 actor 合法命令中均匀抽样，保存命令、事件及每一步完整状态。它拥有全部信息，只用于引擎探索，不代表公平玩家策略。

运行只会分类为 finished、deadlock、rule_error、limit。只有正常终局返回 CLI 退出码 0；探索上限不算通过。无合法动作的活动状态归为 deadlock，而非自动跳过阶段。

重放记录包括格式版本、规范化规则定义、seed、maxSteps、steps 和最终结果。replay 重新编译定义并重执行记录中的命令，逐步比较状态与事件，再校验最终结果。实际命令序列是重放依据，seed 是探索溯源。记录用于错误复现，不是防篡改审计。

CLI 在 `--help` 中给出用法。示例：

```sh
node bin/engine.mjs simulate fixtures/counter.json --seed 42 --max-steps 100 > /tmp/engine-run.json
node bin/engine.mjs replay /tmp/engine-run.json
```

## 扩展验收

每个操作至少覆盖成功、前提失败、边界状态及输入不变性。规则样例的预期由人工编写；不能只比较同一实现生成的两份结果。

未来增加：规则/分支覆盖、非法命令生成、缩减合法失败轨迹、有界状态探索、信息不可区分性检查、同时结算的排列不变性、故障注入。修改故意有缺陷的规则，必须得到非成功报告。

始终报告场景与规则版本、运行数量、终局/死锁/错误/未完成计数。即使零反例，也不能宣称穷尽全部游戏状态或已证明纸质规则正确。
