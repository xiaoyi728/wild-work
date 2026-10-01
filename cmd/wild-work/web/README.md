# 此目录不参与构建 —— 上游 vanilla 面板的 diff 基准

这里的 `index.html` / `app.js` / `style.css` / `pet.js` / `theme.js` / `anim.js` 是上游
rockswang/wild-work 的原生 JS 面板（v2.5.4 融合后的状态，含本地视觉层补丁与桌宠）。

**`cmd/wild-work/main.go` 不再 embed 本目录。** 实际在跑的面板是：

```
cmd/wild-work/webui/    React 源码（Vite 工程）
        ↓ npm run build
cmd/wild-work/web-app/  构建产物 = go:embed 的唯一目标
```

所以**改这里的任何文件都不会改变 exe**，也不会有任何报错提示你这一点
（AGENTS.md §6 不变量 0 记的就是这个失败模式）。

## 那为什么还留着

下次融合上游时，它是唯一能回答「上游到底改了什么行为」的东西。
融合流程见 AGENTS.md §10 L3，三步：

1. 上游 vanilla 照旧落进本目录（保持基准与上游一致，diff 才有意义）；
2. `git diff <旧基准> -- cmd/wild-work/web/` 得到上游**功能改动清单**
   （要的是行为清单，不是内容合并）；
3. 逐条移植进 `cmd/wild-work/webui/src/`，每片跑三道闸门：
   `TestDOMIdParity`（114 个 DOM id 集合差）、`TestPanelAPIRouteContract`（端点）、
   `TestStateFieldContract`（字段）——端点少了、字段少了、id 少了都会报具体名字。

## 移植时的对照表

`cmd/wild-work/webui/FEATURES.md` 是从本目录穷举出来的功能核对单：
114 个 DOM id、10 个弹层、桌宠 8 个 localStorage 键与 8 态优先级、
19 段「是算法不是渲染」的前端业务逻辑，以及 Go 发了但面板从不读的死重字段清单。

## 比对纪律

⚠️ 上游把 `web/app.js` 从 CRLF 转成了 LF。直接 `diff` 会显示整文件重写（+1454/−1211），
真实内容差仅 265 行。**比对任何本目录文件都必须带 `--strip-trailing-cr`**，
否则会误判为「上游重写了前端」。
