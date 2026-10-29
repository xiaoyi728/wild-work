package app

import (
	"strings"
	"testing"

	"wild-work/internal/config"
	"wild-work/internal/provider"
)

// 降级链别名（R129）的保存校验：形态/重名/冲突必须硬拒；保存后规则与 syncer 同步。

func newModelAliasApp(t *testing.T) (*App, *[]config.ModelFallbackRule) {
	t.Helper()
	dir := t.TempDir()
	cfg := config.Default()
	cfg.StateFile = dir + "/state.json"
	cfgPath := dir + "/config.json"
	if err := config.Save(cfg, cfgPath); err != nil {
		t.Fatal(err)
	}
	a, err := New(Options{ConfigPath: cfgPath, Config: cfg, Runtimes: map[provider.Kind]*Runtime{}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.Close)
	synced := &[]config.ModelFallbackRule{}
	a.SetModelFallbackSyncer(func(rules []config.ModelFallbackRule) { *synced = rules })
	return a, synced
}

func TestModelFallbackAliasSave(t *testing.T) {
	a, synced := newModelAliasApp(t)
	warns, err := a.SetModelFallback([]config.ModelFallbackRule{{
		Name: "  gpt  ", From: "workbuddy/deepseek-v4.1-flash", To: []string{"qodercn/glm-5.3"},
	}})
	if err != nil {
		t.Fatalf("合法别名应能保存：%v", err)
	}
	if len(warns) != 0 {
		t.Errorf("无模型目录时不产生软警告，实际 %v", warns)
	}
	a.mu.Lock()
	got := a.cfg.ModelFallback
	a.mu.Unlock()
	if len(got) != 1 || got[0].Name != "gpt" {
		t.Fatalf("别名应 trim 后落盘：%+v", got)
	}
	if len(*synced) != 1 || (*synced)[0].Name != "gpt" {
		t.Fatalf("syncer 应收到带别名的规则：%+v", *synced)
	}
}

func TestModelFallbackAliasRejects(t *testing.T) {
	cases := []struct {
		name string
		rule config.ModelFallbackRule
		want string
	}{
		{"含斜杠", config.ModelFallbackRule{Name: "a/b", From: "workbuddy/x", To: []string{"qodercn/y"}}, "不能含 /"},
		{"含空格", config.ModelFallbackRule{Name: "a b", From: "workbuddy/x", To: []string{"qodercn/y"}}, "空白、逗号或 *"},
		{"含逗号", config.ModelFallbackRule{Name: "a,b", From: "workbuddy/x", To: []string{"qodercn/y"}}, "空白、逗号或 *"},
		{"与渠道同名", config.ModelFallbackRule{Name: "workbuddy", From: "workbuddy/x", To: []string{"qodercn/y"}}, "与渠道名重名"},
		{"与内建命名空间同名", config.ModelFallbackRule{Name: "cline-free", From: "workbuddy/x", To: []string{"qodercn/y"}}, "与渠道名重名"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			a, _ := newModelAliasApp(t)
			_, err := a.SetModelFallback([]config.ModelFallbackRule{c.rule})
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("应报 %q，实际 %v", c.want, err)
			}
		})
	}
}

func TestModelFallbackAliasDuplicate(t *testing.T) {
	a, _ := newModelAliasApp(t)
	_, err := a.SetModelFallback([]config.ModelFallbackRule{
		{Name: "gpt", From: "workbuddy/x", To: []string{"qodercn/y"}},
		{Name: "gpt", From: "qodercn/y", To: []string{"workbuddy/x"}},
	})
	if err == nil || !strings.Contains(err.Error(), "重名") {
		t.Fatalf("重复别名应被拒，实际 %v", err)
	}
}

func TestModelFallbackAliasConflictsWithModelMap(t *testing.T) {
	a, _ := newModelAliasApp(t)
	a.mu.Lock()
	a.cfg.Compat.ModelMap = map[string]string{"gpt": "workbuddy/x"}
	a.mu.Unlock()
	_, err := a.SetModelFallback([]config.ModelFallbackRule{{
		Name: "gpt", From: "workbuddy/x", To: []string{"qodercn/y"},
	}})
	if err == nil || !strings.Contains(err.Error(), "model_map") {
		t.Fatalf("与 model_map 键重名应被拒，实际 %v", err)
	}
}

func TestModelFallbackRejectsAliasInTo(t *testing.T) {
	a, _ := newModelAliasApp(t)
	_, err := a.SetModelFallback([]config.ModelFallbackRule{
		{Name: "gpt", From: "workbuddy/x", To: []string{"qodercn/y"}},
		{Name: "fast", From: "qodercn/y", To: []string{"gpt"}},
	})
	if err == nil || !strings.Contains(err.Error(), "别名") {
		t.Fatalf("备胎链里写别名应被拒，实际 %v", err)
	}
}
