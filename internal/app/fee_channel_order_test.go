package app

// 面板渠道覆盖闸门。
//
// buildFeesChannels 是 `for _, k := range order` 的**枚举**语义，不是排序键：
// 渠道没进 feeChannelOrder，就不会出现在 /api/fees 里，费率表、模型查找面板、
// 用量折线全都拿不到它——不报错、不崩溃，只是那一格永远缺失（R34 家族的
// 「声明了却没接线」）。
//
// 上游 v2.6.3+ 加 Cline 时正踩中这点：internal/cline 全套齐备、面板加了
// 「＋ Cline」按钮与 .ch-header.cline 样式，但 feeChannelOrder 没加，
// 于是 Cline 永远进不了费率面。本测试把「渠道已在 provider 声明」与
// 「渠道已在面板顺序表」两端锁成双向，新增渠道漏接线即变红。
//
// 判据取自 provider.go 源码扫描而非手写清单：手写一份 Kind 列表会和被测对象同错。

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"wild-work/internal/provider"
)

// 面板有意不展示的渠道：旧 Qoder（qoder/*）已从界面下线但路由保留（AGENTS.md R10），
// 存量账号仍可对话，只是不再拉取/展示其模型列表。
var feePanelExempt = map[provider.Kind]string{
	provider.Qoder: "已从界面下线，路由保留",
}

func TestEveryDeclaredKindIsOnFeePanelOrder(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "provider", "provider.go"))
	if err != nil {
		t.Fatalf("读取 provider.go 失败: %v", err)
	}
	// 只认 `Xxx Kind = "yyy"` 形式的常量声明；String() 方法里的 case 不匹配。
	re := regexp.MustCompile(`(?m)^\s*([A-Z]\w*)\s+Kind\s*=\s*"([^"]+)"`)
	found := re.FindAllStringSubmatch(string(b), -1)
	if len(found) < 10 {
		t.Fatalf("只扫到 %d 个 Kind 常量，判据本身失效（正则与声明形态不符？）", len(found))
	}

	inOrder := map[provider.Kind]bool{}
	for _, k := range feeChannelOrder {
		inOrder[k] = true
	}

	var missing []string
	for _, m := range found {
		k := provider.Kind(m[2])
		if feePanelExempt[k] != "" || inOrder[k] {
			continue
		}
		missing = append(missing, m[1]+"("+string(k)+")")
	}
	if len(missing) > 0 {
		t.Errorf("渠道 %v 已在 provider 声明却没进 feeChannelOrder —— 它不会出现在 /api/fees，"+
			"费率表/模型查找/用量折线都拿不到它。确属不上面板的请进 feePanelExempt 并注明缘由。", missing)
	}

	// 反向：顺序表里不该留 provider 已删的渠道名（拼错的字符串常量同样会静默失效，
	// 因为 buildFeesChannels 遇到 modelsByKind 里没有的键只是 continue）。
	declared := map[provider.Kind]bool{}
	for _, m := range found {
		declared[provider.Kind(m[2])] = true
	}
	var ghost []string
	for _, k := range feeChannelOrder {
		if !declared[k] {
			ghost = append(ghost, string(k))
		}
	}
	if len(ghost) > 0 {
		t.Errorf("feeChannelOrder 含 provider 未声明的渠道 %v —— 拼错还是渠道已移除？", ghost)
	}

	t.Logf("provider 声明 %d 个渠道，面板顺序表覆盖 %d 个，豁免 %d 个",
		len(found), len(feeChannelOrder), len(feePanelExempt))
}
