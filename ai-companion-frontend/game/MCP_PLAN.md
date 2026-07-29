# 你画我猜 MCP 接入计划

1. 网页游戏与临时回合服务已完成。✅
2. 内部 game tools 已完成，严格复用现有服务：
   - `draw_start`：沉开始画，或接收辞辞提交的画。
   - `draw_status`：沉查看当前公开画作结构，永不读取答案。
   - `draw_guess`：沉提交猜测，猜错时不泄露答案。
3. 真实 MCP Server stdio transport 已完成。✅
   - 仅通过本机 stdin/stdout 通信，不监听公网端口。
   - MCP handlers 继续调用内部 `game-tools.js` 白名单，不复制游戏逻辑。
   - `draw_status` 只返回公开画作；`draw_guess` 猜错不泄露答案。
   - Gateway 与 MCP 通过私有原子 JSON Round Store 共享两小时内的游戏回合。
   - `draw_start` 返回带 `roundId` 的 `/game/#draw?roundId=...` 链接，游戏页可恢复沉画的回合。
4. 最后让聊天中的沉主动发起和继续游戏：“我们玩你画我猜吧，我来画。”或“你画，我来猜。”

MCP 只是沉参与游戏的工具通道；用户可见玩家身份始终是沉。
