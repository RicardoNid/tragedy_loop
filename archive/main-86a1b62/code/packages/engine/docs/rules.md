# 规则声明

## 当前支持：schemaVersion 1

定义由 id、初始 phase、actors、phases、counters、rules 构成。完整可执行样例见 [counter.json](../fixtures/counter.json)；这是合成计数器场景。

- 标识符限 ASCII 字母开头，其后字母、数字、点、下划线或连字符。
- 每个 phase 指定唯一 actor。当前选择通过该 actor 的不同命令表达。
- counters 为具备 min/max/initial 的安全整数闭区间。
- 每条 rule 必须声明 id、phase、actor、when、effects、outcome。
- when 是合取列表，目前仅支持 counter_gte。空列表表示真。
- effects 是显式顺序执行的 change_counter 列表。越界报 rule_error，不截断。
- outcome 必须且只能是 goto（阶段 ID）或 finish（终局标签）。

定义的所有字段、引用、操作和整数范围都在 compile 校验。规则 ID 全局唯一，phase 的 actor 必须与规则 actor 一致。编译产物深度冻结，并绑定规范化定义全文，便于精确重放；这不是密码学摘要。

目前没有实体查询、目标参数、隐藏信息、触发规则、模块合并或剧本约束。声明这些字段会报错，而非忽略。现有格式是执行骨架，不是完整游戏 DSL，未来版本扩展必须更新 schemaVersion 或明确兼容策略。

## 真实内容的目标模型

来源材料 → 人工审阅 → 结构化规则 → 编译与配置验证 → 可运行定义。

真实声明需扩充：稳定 ID、来源定位与校对状态、触发窗口、主体与目标查询、条件、选择归属、次数及生命周期、效果、信息可见性。事实权威保留在根目录 facts/；本目录仅定义表达与执行合同。

组合器负责解析基础规则包、内容包和剧本，拒绝重复定义、版本不兼容、未解决冲突及不满足剧本约束的组合。新模组和新角色用这些包扩展，不通过向执行器添加名称分支扩展。
