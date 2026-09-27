# 资料校对与规则权威

资料由 ltr 与项目维护者自行校对。Web 页面承担阅读、展示和来源导航，不提供对外协作者校对流程。

- `facts/sources/lunhui` 与 `facts/sources/ricardo` 保存原有材料及其来源身份。
- `facts/research` 保留已有外部来源调查；调查访问成功不等于内容已逐条确认。
- `facts/working/ricardo` 保存旧结构化稿及待完成剧本，不能直接视为独立真值。
- `facts/canonical` 存放已确认政策。当前规则来源权威以 `facts/canonical/source-policy.md`、
  `facts/CONTEXT.md` 和 `facts/decisions/scope.md` 为准；这些记录由并行规则任务维护。
- `packages/content` 与现有引擎维持迁移对照，不以代码或测试数量反向证明规则正确。

Agent将规则冲突整理为：来源/版次、相关原文位置、两种行为及最小示例、建议和待确认项，
由 ltr 最终仲裁。未决项不能被宣称为新正式支持范围。只运行一套内核，不增加可切换的来源规则模式。

当前需继续核对：旧 FAQ 引用的部分转录稿缺失；中文 QA 汇编的逐条原始依据尚未闭合；
本地正文、附录和流程存在已采用不同口径的记录；不同版次的拒绝/轮限解释存在待复核线索。
这些是后续校对任务，本次没有作新的语义裁定。

`docs/development/rule-baseline.json` 只迁移路径，五个原内容 SHA256 未改变。
旧裁定在 `docs/archive/lunhui-engine/rulings.md`，旧来源 SHA 在
`docs/archive/integration/sources.json`。归档记录“已采用”不等于本次确认。

并行规则任务已记录采用 Lunhui 整理结果作为权威、排除 Ricardo 规则解释。
本次保留 Ricardo 原始资料只作来源归档和迁移追溯，不将其重新纳入运行规则。
工程迁移不修订该任务的规则范围，也不据测试通过追加新的规则裁定。
