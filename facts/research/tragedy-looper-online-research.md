# 惨剧轮回公开资料检索笔记

检索日期：2026-06-20

## 名称与版本脉络

- 日文原名常见为 `惨劇RoopeR`，英文版名为 `Tragedy Looper`，中文圈常译作 `惨剧轮回` 或 `悲剧轮回`。
- 官方页标注 BakaFire Party 自 2011 年开始发布相关内容，设计署名为 BakaFire / BakaFire Party。
- Z-Man Games 曾发行英文版 `Tragedy Looper`。
- `Tragedy Looper: New Tragedies` 是后续英文新版/独立续作，WizKids 商店页称其收录 13 个剧本和 30 名角色，并把更多 BakaFire 后续内容带入英文版。
- BakaFire 官方在 2025-02-19 发布消息，称 `惨劇RoopeR` 已在 CCFOLIA 上推出线上游玩版本，收录现行 `5th` 包内容，并包含部分活动推广卡与脚本集角色。

## 核心玩法摘要

- 游戏是非对称推理：1 名玩家担任 Mastermind / 脚本家，1-3 名玩家担任 Protagonists / 主人公。
- 每局基于一个 script / 脚本。脚本家知道完整脚本，包括角色身份、主线、支线、事件和触发条件；主人公只知道公开信息。
- 游戏由多个 loop / 轮回组成，每个轮回包含多个 day / 日。
- 常见地点为 Hospital、Shrine、City、School 四个区域。
- 每天双方将行动牌暗置到角色或地点上，再揭示并结算，用来移动角色或改变 paranoia、goodwill、intrigue 等状态。
- 事件通常由预定日期、犯人、犯人存活、paranoia 阈值和额外条件共同决定是否发生。
- 主人公的目标是在有限轮回中阻止惨剧，或在最终猜测中识破角色身份；脚本家的目标是让主人公在所有轮回中失败并挡住最终猜测。

## 可供项目参考的设计点

- 电子版需要完整记录“谁在何时对谁做了什么”，因为行动日志本身会成为推理线索。
- 数据模型应区分公开脚本信息与脚本家私密信息。
- 教学材料应优先解释轮回、公开信息、暗置行动牌、角色能力、事件触发、最终猜测，而不是先灌输全部惨剧集细则。
- 线上联机需要支持隐藏信息、脚本家私密 UI、主人公共享讨论区、回放/日志、轮回重置，以及最终猜测流程。
- 需要先确认我们手上的纸质版具体对应哪个版本，再决定术语和数据字段是否以日文原版、英文版或中文版为准。

## 后续需要纸质扫描补齐

- 纸质版的准确中文术语表。
- 角色卡名称、初始地点、特性、友好能力、偏执上限等结构化字段。
- 行动牌、事件、角色身份、惨剧集/规则表的准确字段。
- 纸质版附带剧本的公开/非公开信息，以及是否适合用于新人教学。
- 组件数量、版次差异和中文出版信息。

## Sources

- BakaFire Party official page: https://bakafire.main.jp/rooper/sr_top.htm
- BakaFire official CCFOLIA announcement: https://bakafire.main.jp/rooper/sr_news_250219.htm
- BakaFire 10th anniversary page: https://main-bakafire.ssl-lolipop.jp/rooper/10th/
- Z-Man Games official rules PDF: https://images.zmangames.com/filer_public/bc/e8/bce8e73f-d200-4a9f-be90-b3c59b8bb330/zm7470_tragedy_looper_rules.pdf
- WizKids `Tragedy Looper: New Tragedies`: https://shop.wizkids.com/products/tragedy-looper-new-tragedies
- BoardGameBlitz how-to-play transcript: https://www.boardgameblitz.com/posts/68/how-to-play-tragedy-looper
- BoardGameGeek entry: https://boardgamegeek.com/boardgame/148319/tragedy-looper
- 惨劇RoopeR 脚本データベース: https://sangeki.boardgame.work/
- 惨劇RoopeR Android helper app: https://play.google.com/store/apps/details?id=work.boardgame.sangeki_rooper&hl=ja
- 桌游库中文条目: https://www.zhuoyouku.com/boardgame/xx2ywnjagfmwh4l8yvh4m56v

