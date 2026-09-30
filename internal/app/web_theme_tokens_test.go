package app

// 主题 token 与渠道色映射的静态闸门（阶段 2）。
//
// 起因是 vanilla 的真实缺陷：app.js 的 CH_VAR 少了 glm，智谱清言折线一直画成主色。
// 这类 bug 不报错、不崩溃，只是颜色不对，所以用静态断言兜住。
//
// 渠道集合**不写死**：直接取面板的权威枚举 feeChannelOrder（再加已下线的旧 qoder）。
// 以后加第 11 个渠道时，本测试会自动要求它既有主题色变量又有 CH_VAR 映射；
// 若在这里硬编码一份 10 个的正则，新渠道只会悄悄掉进 --accent 兜底而无人报警。

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"wild-work/internal/provider"
)

// channelColors.js 里 `key: '--var'` 形式的映射目标。
var chVarMapRe = regexp.MustCompile(`[a-zA-Z]+:\s*'(--[a-z-]+)'`)

func readFile(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "cmd", "wild-work", "webui", rel))
	if err != nil {
		t.Skipf("React 侧文件不存在（尚未建工程）: %v", err)
	}
	return string(b)
}

func panelChannels() []string {
	out := make([]string, 0, len(feeChannelOrder)+1)
	for _, k := range feeChannelOrder {
		out = append(out, string(k))
	}
	// 旧 Qoder 已从界面下线但路由保留（AGENTS.md R10），存量账号仍会出现在用量流水里。
	out = append(out, string(provider.Qoder))
	return out
}

// Kind → 变量名。workbuddy/traework 系是缩写惯例，其余直接用 kind 名。
var varOverride = map[string]string{
	"workbuddy":   "--wb",
	"workbuddyai": "--wbai",
	"traework":    "--trae",
}

func expectedVar(ch string) string {
	if v, ok := varOverride[ch]; ok {
		return v
	}
	return "--" + ch
}

func TestChannelColorVarsAllMapped(t *testing.T) {
	tokens := readFile(t, "src/tokens.css")
	mapped := map[string]bool{}
	for _, m := range chVarMapRe.FindAllStringSubmatch(readFile(t, "src/channelColors.js"), -1) {
		mapped[m[1]] = true
	}

	chans := panelChannels()
	var missingVar, missingMap []string
	for _, ch := range chans {
		v := expectedVar(ch)
		if !strings.Contains(tokens, v+":") {
			missingVar = append(missingVar, ch+"(缺 "+v+")")
		}
		if !mapped[v] {
			missingMap = append(missingMap, ch+"("+v+" 未映射)")
		}
	}
	if len(missingVar) > 0 {
		t.Errorf("渠道 %v 在 tokens.css 没有主题色变量 —— 新渠道须 light/dark/paper 各加一份", missingVar)
	}
	if len(missingMap) > 0 {
		t.Errorf("渠道 %v 没进 channelColors.js 的 CH_VAR —— 对应折线会静默画成 --accent 兜底色（glm 就是这个 bug）", missingMap)
	}
	// 反向：映射表里不该有 Go 侧不认识的渠道色变量
	known := map[string]bool{}
	for _, ch := range chans {
		known[expectedVar(ch)] = true
	}
	var orphan []string
	for v := range mapped {
		if !known[v] && v != "--accent" {
			orphan = append(orphan, v)
		}
	}
	if len(orphan) > 0 {
		t.Errorf("channelColors.js 映射了 Go 侧无此渠道的变量 %v —— 渠道已移除还是变量名写错？", orphan)
	}
	t.Logf("渠道 %d 个，主题色变量与 CH_VAR 映射齐备", len(chans))
}

// 三主题对账：每个渠道色变量必须在 light / dark / paper 三处都出现，
// 否则某个主题下按钮会失色（AGENTS.md L1 明确要求三处同步）。
func TestChannelColorsExistInAllThreeThemes(t *testing.T) {
	tokens := readFile(t, "src/tokens.css")

	// 不能用「第 N 个 :root 块」这种位置猜测：tokens.css 里还有 @supports 包着的
	// oklch 版 :root，以及文件末尾与主题无关的字号阶梯 :root —— 上一版就是取到
	// 最后一个块（字号阶梯），把 dark 误判成"所有渠道色都缺"。
	// 改为按各自锚点定位，再取锚点之后的第一个平铺块。
	type theme struct{ name, anchor string }
	anchors := []theme{
		{"light", ":root {"},
		{"dark", "@media (prefers-color-scheme: dark) {"},
		{"paper", `html[data-theme="paper"] {`},
	}
	flatBlockRe := regexp.MustCompile(`\{([^}]*)\}`)
	blocks := map[string]string{}
	for _, a := range anchors {
		i := strings.Index(tokens, a.anchor)
		if i < 0 {
			t.Fatalf("扫不到 %s 主题锚点 %q", a.name, a.anchor)
		}
		rest := tokens[i+len(a.anchor):]
		if a.name == "dark" {
			// 锚点命中的是 @media 本身，要往里找第一个 :root 平铺块（hex 版）
			j := strings.Index(rest, ":root {")
			if j < 0 {
				t.Fatalf("dark 主题 @media 内找不到 :root 块")
			}
			rest = rest[j+len(":root {"):]
		}
		m := flatBlockRe.FindStringSubmatch("{" + rest)
		if m == nil {
			t.Fatalf("%s 主题块解析失败", a.name)
		}
		blocks[a.name] = m[1]
	}

	for _, a := range anchors {
		var absent []string
		for _, ch := range panelChannels() {
			v := expectedVar(ch)
			if !strings.Contains(blocks[a.name], v+":") {
				absent = append(absent, ch+"("+v+")")
			}
		}
		if len(absent) > 0 {
			t.Errorf("%s 主题缺渠道色 %v —— 该主题下这些渠道的按钮/折线会失色", a.name, absent)
		}
	}
	t.Logf("三主题渠道色对账通过：%d 个渠道在 light/dark/paper 各一份", len(panelChannels()))
}
