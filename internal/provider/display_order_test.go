package provider

import "testing"

// TestDisplayNamesCoverAllBuiltins 显示名表必须覆盖全部内建渠道（R142）。
// 漏一个会让该渠道的名字回退成裸 kind（面板上显得与其它渠道不同口径），
// 也会让 ChannelDisplayOrder 按 kind 字节序而不是显示名出序。
func TestDisplayNamesCoverAllBuiltins(t *testing.T) {
	for _, k := range builtinKindList {
		if _, ok := DisplayNames[k]; !ok {
			t.Errorf("渠道 %s 缺显示名（会回退成裸 kind，且排序口径与其它渠道不一致）", k)
		}
	}
	for k := range DisplayNames {
		if !BuiltinKinds()[k.String()] {
			t.Errorf("显示名表里有非内建渠道 %s", k)
		}
	}
}

// TestDisplayNameFallback 未登记渠道（自定义渠道）回退成 kind 本身。
func TestDisplayNameFallback(t *testing.T) {
	if got := DisplayName(Kind("mycustom")); got != "mycustom" {
		t.Fatalf("DisplayName(mycustom) = %q，want \"mycustom\"", got)
	}
	if got := DisplayName(Raccoon); got != "小浣熊" {
		t.Fatalf("DisplayName(raccoon) = %q，want \"小浣熊\"", got)
	}
}

// TestChannelDisplayOrderIsByteOrder：展示序 = 显示名的 UTF-8 字节序升序（R142）。
// 锁住 Go 字符串比较（= 字节序）与之一致，并给出可读的失败信息。
func TestChannelDisplayOrderIsByteOrder(t *testing.T) {
	if len(ChannelDisplayOrder) != len(builtinKindList) {
		t.Fatalf("ChannelDisplayOrder 长 %d，builtinKindList 长 %d", len(ChannelDisplayOrder), len(builtinKindList))
	}
	seen := map[Kind]bool{}
	for _, k := range ChannelDisplayOrder {
		if seen[k] {
			t.Errorf("ChannelDisplayOrder 有重复项 %s", k)
		}
		seen[k] = true
	}
	for i := 1; i < len(ChannelDisplayOrder); i++ {
		prev, cur := ChannelDisplayOrder[i-1], ChannelDisplayOrder[i]
		if DisplayName(prev) > DisplayName(cur) {
			t.Fatalf("展示序错：第 %d 位 %q(%s) 排在 %q(%s) 之前，但应按显示名字节序升序",
				i, DisplayName(prev), prev, DisplayName(cur), cur)
		}
	}
}

// TestChannelDisplayOrderSpotChecks 关键位置的期望值（防止「排序规则没坏但结果意外」）：
// ASCII 名字在前、中文显示名垫底，WorkBuddyAI 在 WorkBuddyCN 之前（'A' < 'C'）。
func TestChannelDisplayOrderSpotChecks(t *testing.T) {
	pos := map[Kind]int{}
	for i, k := range ChannelDisplayOrder {
		pos[k] = i
	}
	if pos[Cline] > pos[Oczen] {
		t.Errorf("Cline 应在 Oczen 之前（'C' < 'O'）")
	}
	if !(pos[WorkBuddyAI] < pos[WorkBuddy]) {
		t.Errorf("WorkBuddyAI 应在 WorkBuddyCN(WorkBuddy) 之前（'A' < 'C'）")
	}
	for _, k := range []Kind{QwenWork, Raccoon, GLM} {
		if pos[k] < pos[TraeWork] {
			t.Errorf("中文显示名渠道 %s(%s) 应垫底（在 TraeWork 之后）", k, DisplayName(k))
		}
	}
}
