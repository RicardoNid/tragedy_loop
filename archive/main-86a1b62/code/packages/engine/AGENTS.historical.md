# 新规则引擎

本 package 是独立重写。`../../web/core/` 只供行为比较；游戏事实以根目录 `facts/` 中经审阅且有来源的资料为准。合成 fixtures 不代表游戏规则。

每次改动先读 [设计原则](docs/principles.md) 和 [里程碑](docs/milestones.md)，确定本次工作的边界。

- 修改规则格式、加载或新增操作：读 [规则声明](docs/rules.md)。
- 修改状态、命令、结算或错误行为：读 [执行契约](docs/execution.md)。
- 修改模拟、随机策略、重放或测试：读 [验证契约](docs/verification.md)。
- 接入真实模组、角色或替换旧原型：读 [迁移路线](docs/migration.md)。

完成标准：相关契约与实现一致；运行 package 测试；新增规则行为有独立预期用例；未实现的语义显式拒绝。根目录的文件链接指向这里即可，不复制本 package 的契约。
