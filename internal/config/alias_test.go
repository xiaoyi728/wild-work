package config

import "testing"

// 降级链别名索引（R129）：派生唯一来源，脏名/重名/空 From 一律跳过。

func TestAliasIndex(t *testing.T) {
	rules := []ModelFallbackRule{
		{Name: "gpt", From: "workbuddy/deepseek", To: []string{"qodercn/glm"}},
		{Name: "  fast  ", From: " qodercn/glm ", To: []string{"workbuddy/x"}},
		{Name: "gpt", From: "other/model", To: []string{"x/y"}}, // 重名：先到先得
		{Name: "a/b", From: "x/y", To: []string{"z/w"}},         // 含 /：跳过
		{Name: "a b", From: "x/y", To: []string{"z/w"}},         // 含空白：跳过
		{Name: "emptyfrom", From: "   ", To: []string{"z/w"}},   // 空 From：跳过
		{From: "norename/model", To: []string{"z/w"}},           // 无别名：跳过
	}
	idx := AliasIndex(rules)
	want := map[string]string{
		"gpt":  "workbuddy/deepseek",
		"fast": "qodercn/glm",
	}
	if len(idx) != len(want) {
		t.Fatalf("AliasIndex = %v, want %v", idx, want)
	}
	for k, v := range want {
		if idx[k] != v {
			t.Errorf("idx[%q] = %q, want %q", k, idx[k], v)
		}
	}
}

func TestValidAliasName(t *testing.T) {
	ok := []string{"gpt", "fast-4", "a_b", "Fast", "别名"}
	bad := []string{"", "a/b", "a b", "a\tb", "a,b", "a*", "a\u3000b", "a，b"}
	for _, s := range ok {
		if !ValidAliasName(s) {
			t.Errorf("ValidAliasName(%q) 应为 true", s)
		}
	}
	for _, s := range bad {
		if ValidAliasName(s) {
			t.Errorf("ValidAliasName(%q) 应为 false", s)
		}
	}
}
