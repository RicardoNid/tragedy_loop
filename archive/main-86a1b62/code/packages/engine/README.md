# @tragedy-loop/engine

从零重写的规则引擎 package。当前交付 M0：可执行的声明与模拟骨架，尚不支持完整《惨剧轮回》游戏。旧 Web 引擎仅供参考，不是本包依赖。

从 [AGENTS.md](AGENTS.md) 进入按任务披露的设计上下文；实现范围见 [里程碑](docs/milestones.md)。

```sh
npm --prefix code/packages/engine test
npm --prefix code/packages/engine run simulate -- --seed 42 --max-steps 100
```

CLI 的 JSON 重定向与重放命令见 [验证契约](docs/verification.md)。核心公共入口是 src/index.mjs；Node 文件访问仅存在于 bin/，策略位于 simulator.mjs。
