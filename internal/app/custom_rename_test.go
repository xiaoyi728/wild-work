package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"wild-work/internal/config"
	"wild-work/internal/custom"
	"wild-work/internal/provider"
)

// custom_rename_test.go：自定义渠道标识改名级联（R122）。
//
// 标识就是 provider.Kind：密钥找回、四类引用配置、状态文件、两个 syncer 都必须联动，
// 漏任何一项都是「配置还在、永久静默失效」或「真 key 被空串覆盖」。

func newRenameApp(t *testing.T) (*App, string) {
	t.Helper()
	dir := t.TempDir()
	cfg := config.Default()
	cfg.StateFile = filepath.Join(dir, "state.json")
	cfgPath := filepath.Join(dir, "config.json")
	cfg.CustomChannels = []custom.ChannelConfig{{
		Name: "old", BaseURL: "https://api.example/v1", APIKey: "sk-test-1234567890",
		Models: []custom.ModelConfig{{ID: "m1"}},
	}}
	cfg.Compat.ModelMap = map[string]string{"fast": "old/m1"}
	cfg.Compat.DefaultChannel = "old"
	cfg.ModelFallback = []config.ModelFallbackRule{{From: "old/m1", To: []string{"old/m2"}}}
	cfg.ReasoningEfforts = map[string]string{"old/m1": "high", "*": "low"}
	if err := config.Save(cfg, cfgPath); err != nil {
		t.Fatal(err)
	}
	// 旧状态文件（应被留档为 .old）
	if err := os.WriteFile(filepath.Join(dir, "state-custom-old.json"), []byte(`{"version":3,"accounts":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	a, err := New(Options{ConfigPath: cfgPath, Config: cfg, Runtimes: map[provider.Kind]*Runtime{}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.Close)
	return a, dir
}

func TestCustomChannelRenameCascade(t *testing.T) {
	a, dir := newRenameApp(t)

	var synced []custom.ChannelConfig
	var fbRules []config.ModelFallbackRule
	var efforts map[string]string
	a.SetCustomChannelsSyncer(func(cs []custom.ChannelConfig) { synced = cs })
	a.SetModelFallbackSyncer(func(rules []config.ModelFallbackRule) { fbRules = rules })
	a.SetReasoningEffortsSyncer(func(e map[string]string) { efforts = e })

	// 面板提交的是脱敏 key（未改动）+ 新名 + 改名声明
	next := []custom.ChannelConfig{a.cfg.CustomChannels[0]}
	next[0].APIKey = maskCustomChannels(next)[0].APIKey
	next[0].Name = "renamed"
	if err := a.SetCustomChannels(next, customRename{New: "renamed", Old: "old"}); err != nil {
		t.Fatalf("改名保存失败：%v", err)
	}

	a.mu.Lock()
	got := a.cfg
	a.mu.Unlock()

	if len(got.CustomChannels) != 1 || got.CustomChannels[0].Name != "renamed" {
		t.Fatalf("渠道名未更新：%+v", got.CustomChannels)
	}
	// ① 按旧名找回真实密钥（否则会被脱敏串/空串覆盖并落盘）
	if got.CustomChannels[0].APIKey != "sk-test-1234567890" {
		t.Fatalf("真密钥没找回来（落盘=%q）——这是最致命的一条", got.CustomChannels[0].APIKey)
	}
	// ② 四类引用联动
	if got.Compat.ModelMap["fast"] != "renamed/m1" {
		t.Errorf("compat.model_map 未联动：%v", got.Compat.ModelMap)
	}
	if got.Compat.DefaultChannel != "renamed" {
		t.Errorf("compat.default_channel 未联动：%q", got.Compat.DefaultChannel)
	}
	if got.ModelFallback[0].From != "renamed/m1" || got.ModelFallback[0].To[0] != "renamed/m2" {
		t.Errorf("model_fallback 未联动：%+v", got.ModelFallback[0])
	}
	if _, oldKey := got.ReasoningEfforts["old/m1"]; oldKey {
		t.Errorf("reasoning_efforts 键未联动：%v", got.ReasoningEfforts)
	}
	if got.ReasoningEfforts["renamed/m1"] != "high" || got.ReasoningEfforts["*"] != "low" {
		t.Errorf("reasoning_efforts 改写错误：%v", got.ReasoningEfforts)
	}
	// ③ 旧状态文件留档 .old，不搬到新名
	if _, err := os.Stat(filepath.Join(dir, "state-custom-old.json")); !os.IsNotExist(err) {
		t.Error("旧 state 文件应被改名留档，不应原样留在原处")
	}
	if _, err := os.Stat(filepath.Join(dir, "state-custom-old.json.old")); err != nil {
		t.Errorf("旧 state 文件的 .old 留档缺失：%v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "state-custom-renamed.json")); !os.IsNotExist(err) {
		t.Error("不得把旧状态搬到新名下（旧文件里的 UID 是 custom-old）")
	}
	// ④ 两个 syncer 都被推（Handler 里的内存副本必须同步换 key）
	if len(synced) != 1 || synced[0].Name != "renamed" {
		t.Errorf("custom syncer 未收到新表：%+v", synced)
	}
	if len(fbRules) != 1 || fbRules[0].From != "renamed/m1" {
		t.Errorf("fallback syncer 未收到改写后的规则：%+v", fbRules)
	}
	if efforts["renamed/m1"] != "high" {
		t.Errorf("effort syncer 未收到改写后的映射：%v", efforts)
	}
}

func TestCustomChannelRenameInvalidDropped(t *testing.T) {
	cases := []struct {
		name string
		ren  customRename
	}{
		{"旧名不存在", customRename{New: "new", Old: "ghost"}},
		{"新旧相同", customRename{New: "old", Old: "old"}},
		{"新名与现有渠道冲突", customRename{New: "other", Old: "old"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			a, dir := newRenameApp(t)
			if c.ren.New == "other" {
				a.mu.Lock()
				a.cfg.CustomChannels = append(a.cfg.CustomChannels, custom.ChannelConfig{
					Name: "other", BaseURL: "https://api.other/v1", APIKey: "sk-other",
				})
				a.mu.Unlock()
			}
			next := []custom.ChannelConfig{{Name: "old", BaseURL: "https://api.example/v1", APIKey: "sk-test-1234567890",
				Models: []custom.ModelConfig{{ID: "m1"}}}}
			if err := a.SetCustomChannels(next, c.ren); err != nil {
				t.Fatalf("非法改名应静默丢弃而不是报错：%v", err)
			}
			if _, err := os.Stat(filepath.Join(dir, "state-custom-old.json")); err != nil {
				t.Error("非法改名不得迁移状态文件")
			}
			a.mu.Lock()
			defer a.mu.Unlock()
			if a.cfg.CustomChannels[0].APIKey != "sk-test-1234567890" {
				t.Errorf("非法改名不得丢密钥：%q", a.cfg.CustomChannels[0].APIKey)
			}
			if !strings.HasPrefix(a.cfg.Compat.DefaultChannel, "old") {
				t.Errorf("非法改名不得改写引用：%q", a.cfg.Compat.DefaultChannel)
			}
		})
	}
}

// 渠道标识统一小写（custom.Validate 会 ToLower）：仅改大小写等价于没改名，
// 必须是 no-op —— 绝不能把引用改写成大小写不一致的值（Kind 大小写敏感，路由会断）。
func TestCustomChannelRenameCaseOnlyIsNoop(t *testing.T) {
	a, dir := newRenameApp(t)
	next := []custom.ChannelConfig{{Name: "OLD", BaseURL: "https://api.example/v1",
		APIKey: "sk-test-1234567890", Models: []custom.ModelConfig{{ID: "m1"}}}}
	if err := a.SetCustomChannels(next, customRename{New: "OLD", Old: "old"}); err != nil {
		t.Fatalf("仅大小写改名应被当作 no-op 而不是报错：%v", err)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg.CustomChannels[0].Name != "old" {
		t.Fatalf("标识应规范化为小写 old：%+v", a.cfg.CustomChannels)
	}
	if a.cfg.Compat.DefaultChannel != "old" || a.cfg.Compat.ModelMap["fast"] != "old/m1" {
		t.Fatalf("no-op 不得改写引用：default=%q map=%v", a.cfg.Compat.DefaultChannel, a.cfg.Compat.ModelMap)
	}
	if a.cfg.ModelFallback[0].From != "old/m1" || a.cfg.ReasoningEfforts["old/m1"] != "high" {
		t.Fatalf("no-op 不得改写下级引用：%+v %v", a.cfg.ModelFallback[0], a.cfg.ReasoningEfforts)
	}
	if _, err := os.Stat(filepath.Join(dir, "state-custom-old.json")); err != nil {
		t.Error("no-op 不得迁移状态文件")
	}
	if a.cfg.CustomChannels[0].APIKey != "sk-test-1234567890" {
		t.Errorf("密钥不得丢：%q", a.cfg.CustomChannels[0].APIKey)
	}
}
