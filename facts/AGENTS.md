# 规则资料工作入口

先读 [CONTEXT.md](CONTEXT.md) 和 [来源约定](canonical/source-policy.md)。只按当前约定合并：wiki > lloyd > ricardo。

资料按领域分类，不按程序组件组织。阅读器入口是 index.html；规则数据在 data/ 下的分类目录，长正文在 text，原始出处在 sources。只看需要的条目，不一次加载全部快照。

改条目先核对来源快照及字段出处；生成文件由 tools/build_wiki.py 重建，不直接改生成结果。语义不同版本保留独立条目；同名身份和事件必须带模组作用域。不要修订拼写或翻译来制造一致性，不补齐人数变体。

采集见 sources/wiki/index.json 与 data/coverage.json。失败、空白、未采集分开；页面数、测试通过或界面可用均不能证明全量。禁止导出登录凭据。

变更后执行 tools/build_wiki.py，并核对 JSON、正文引用和阅读器。规则实现、部署不在本目录工作范围。
