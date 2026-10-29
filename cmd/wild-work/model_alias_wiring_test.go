package main

import (
	"os"
	"strings"
	"testing"
)

// model_alias_wiring_test.go：别名表必须**启动 + 热更新**两条路径都接线（R129 / R61 同族）。
//
// 只实现后者等于「保存过才生效」：进程重启后 Chat 能用别名、Codex 不能用，
// 直到用户重新保存一次降级链。静态扫 main.go 是唯一能在源码层拦住这种漏接线的判据。

func TestModelAliasWiring(t *testing.T) {
	raw, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	src := string(raw)

	if !strings.Contains(src, "Aliases: config.AliasIndex(cfg.ModelFallback)") {
		t.Error("启动装配缺少 Router.Aliases（重启后兼容层不认别名）")
	}
	if !strings.Contains(src, "compat.SetAliases(config.AliasIndex(rules))") {
		t.Error("降级链热更新缺少 compat.SetAliases（保存后 Codex/Claude Code 不认别名）")
	}
	if !strings.Contains(src, "inner.SetModelFallbacks(rules)") {
		t.Error("降级链热更新缺少 inner.SetModelFallbacks（内层 Chat 不认别名）")
	}
}
