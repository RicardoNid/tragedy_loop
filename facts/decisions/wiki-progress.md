# 当前状态：本地 Wiki 已交付

最终核对与边界见 [completion-audit.md](completion-audit.md)。以下保留历史过程，早期“待完成”项不代表当前状态。

# 本地 Wiki 重构进度

目标保持完整：三源合并，wiki > lloyd > ricardo，facts/index.html 可视化入口，规则 JSON 与正文独立。用户说明 FEX 是 facts 的口述误差。

## 本轮证据

- Edge 用户当前已登录 Fandom；已刷新普通文章页面，用户菜单可见。未导出 Cookie。
- sources/wiki/index.json 收集 Special:AllPages 三页，共917条（包括重定向），首页计数916；以目录条目逐项核对。
- sources/wiki/pages 每页保存 DOM 正文、表格单元格跨度、链接、图片地址和可见固定版本链接。部分子页确实空白，status=empty-source。
- 目前917条主目录条目已全部采集。排序：先非剧本名，再按原索引顺序采集。继续时从磁盘已存 requestedTitle 去重，不仅依赖此数。
- tools/browser-capture.reference.js 是 cua_repl 采集函数参考；必须通过支持的 browser API 操作。绑定 wikiPage（Edge 812631855）、wikiFs（node:fs/promises）、wikiCrypto（node:crypto）、wikiDir 后使用。单页间隔1500ms，单并发；正文容器 waitFor 已加入。首页重定向曾导致导航等待超时，检查实际页面后记录了 redirectTo。
- 当前发现的44张原图已下载至 media/wiki，文件长度、SHA256 和来源标示尺寸均核验通过，共18,472,524字节。后续未采集条目可能带来新增素材，不能称为完整离线资料。
- 命令行 robots.txt 遇403挑战，Edge 对该地址 ERR_BLOCKED_BY_CLIENT；未绕过。正常文章浏览可用；遇限流／验证停止。
- tools/build_wiki.py 从本地快照、Lloyd附录JSON、Ricardo草稿生成 data 与 text；不联网、不依赖运行引擎。
- 浏览器已验证首页、AI搜索、合并AI字段及来源。静态验证见 tools/verify_wiki.py；它检查代表性规则与路径，不能证明所有解析均正确。

## 待完成（不得据当前成果缩小目标）

1. 完成917条全部采集，核对重定向、空白与失败；继续枚举分类及素材页，检查链接到但未在主命名空间索引中的规则材料。
2. 完成本地图片／附件资料及原始许可留证；不把图片链接当已获取内容。
3. FAQ问答对与剧本轮数/天数已提取；继续完善角色能力阈值、术语关系、剧本公开与非公开结构。当前部分字段仍是完整原文数组，不能误报全面语义解析。
4. 16模组已由独立来源复核匹配条目数量与多行效果，见 research/module-extraction-audit.md。已修复AH/HS漏行、Sin City错列与隐匿者特性覆盖；后续变更需保持这一验证。Wiki优先时，不能混用低优先级的不同字段名绕开覆盖顺序。
5. 将非运行组件的相关游戏资料集中纳入facts。工程文档留作历史来源但不进入读者规则分类；检查现有外部裁定、FAQ等散落材料。不要撤销其他任务正在进行的工程目录归档。
6. 进一步统一三源的同实体入口，原始来源保留快照，不使读者按来源浏览重复规则。
7. 已收录的正文链接已指向本地对应条目，后续完善图像与带锚点链接；对外出处链接仍保留。完善直接打开HTML的使用路径与错误提示，验证全部数据、链接、分类、搜索、秘密表折叠、移动端及图片。
8. 记录结构决定与渐进式导航；完成逐项验收后才能将goal标记complete。

当前没有后台采集任务；各批通过 cua_repl 显式执行并落盘。继续时从 sources/wiki/pages 去重续采，不必重抓已成功页面。

本轮新增：实体JSON与正文按领域分目录存储（data/<kind>/*.json 与 text/<kind>/*.txt）；catalog给出path，阅读器按path加载。已建立结构ADR与media-index（当前44图片文件页），原图已获取并验证；来源快照继续增长，以 data/coverage.json 及实际快照为准。

最近批次在全部18条保存后，cua_repl达到60秒上限并重置。磁盘确认618条，下一次需重建浏览器绑定与采集函数，从requestedTitle去重续采；不存在后台采集。

恢复后采用每批15条、单并发、请求间隔1500ms续采，本轮新增120条至738/917，生成1322个实体并通过路径和出处检查。当前批次索引pendingWiki起于618，已保存[0,120)，下次仍以磁盘requestedTitle去重。

最新：838/917已保存，MZ-55非公开信息表触发Cloudflare安全验证，页面等待后仍停在验证状态；已停止新请求并请用户处理。未将验证页存为空条目。剩余79条，以coverage.pending为准。浏览器绑定仍在，恢复后须按磁盘去重。新增scenario_fields.py，提取明确剧本编号、无限或整数轮数、天数、公开事件日程及明确的规则X/Y，BTX-01和HSA-27对照原文验证。

本地合并补充：Ricardo模组Markdown表作为最低优先候选并入相应实体，First Steps医院事故具三源且Wiki仍选中。剧本以明确编号建立公开/秘密页双向关联。浏览器刷新后验证公开日程与相关条目显示，秘密页在点击前不显示规则谜底。verify_wiki.py加入三源候选、双向关联及无限轮回归检查。原站验证页仍未恢复，本轮没有新外部请求。

主目录采集完成：917/917，1501实体，44已发现原图校验通过。Cloudflare已自然/用户侧恢复，改为3000ms间隔并用locator逐元素读取（evaluate持续超时）；参考函数已更新。当前采集标签页812631892，旧用户标签812631855保留。linked-pages-audit.json记录62个主索引之外的链接目标，普通正文无遗漏，分类/素材/帮助等仍待范围核对。全文完整性与三源整合未完成，不得将coverage.complete等同goal完成。

素材全目录补查：Special:AllPages选File后列出56项（file-namespace-index.json）。原先44项之外12项已逐页核对（file-audit/），Aquarium.jpg原站明确不存在，其余11项已下载，共55项。新增图片与素材分类，包含无正文引用的社区角色图。共享库可能响应WebP；按实际签名保存并核对源尺寸。Favicon.ico源未标尺寸，只验证ICO签名、字节数及哈希。仍需分类目录核对、三源正文整理和最终验收。

本地正文入口整理：内部JSON不再作为整篇游戏规则展示；原文标题替代文件名；整表/核查稿进入references，FAQ进入faq，基础书保留articles。source-inventory.json对本地来源逐文件记录SHA与处理方式；Lloyd四张图片进入素材库。生成1558条目，引用与来源验证通过。分类命名空间及混合工程裁定摘录、最终UI/全量审计仍未结束。

分类核对完成：category-index.json为6分类完整列表，categories/包含9个分页快照；category-coverage.json核对391公开剧本与409秘密剧本成员均在917主索引内。模板/模板文件是Wiki排版设施、博客分类为空（推荐热门条目不作为成员）。旧引擎rulings的游戏口径已摘入sources/lunhui/既有规则裁定摘录.md，记录原件SHA并排除实现部分。1559实体全字段优先级审计未发现绕过；verify_wiki.py已固化全字段优先级检查。主目录162条原站空白。仍需最终呈现及覆盖审计，不将来源历史文本视为全新官方裁定。
