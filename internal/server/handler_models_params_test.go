package server

import (
	"strings"
	"testing"

	"wild-work/internal/provider"
)

// handler_models_params_test.go：/v1/models 的 OpenRouter 规范字段（R124）。
//
// 规则：supported_parameters 只列已声明的能力；两者皆无时整个字段缺席；
// reasoning.mandatory 只在上游明确给过 can_disable_thinking 时出现；
// include_reasoning 等本仓不处理的参数绝不对外宣告（R49「不编造」）。

func paramsOf(entry map[string]any) []string {
	raw, ok := entry["supported_parameters"].([]string)
	if !ok {
		return nil
	}
	return raw
}

func TestModelEntrySupportedParameters(t *testing.T) {
	yes, no := true, false

	t.Run("工具+思考档位", func(t *testing.T) {
		mi := provider.ModelInfo{
			ID: "m", SupportsTools: true,
			ReasoningEfforts: []string{"low", "high"}, DefaultReasoningEffort: "high",
			CanDisableThinking: &no,
		}
		e := buildModelEntry(provider.WorkBuddy, mi)
		got := paramsOf(e)
		want := map[string]bool{"tools": true, "tool_choice": true, "reasoning": true, "reasoning_effort": true}
		if len(got) != len(want) {
			t.Fatalf("supported_parameters = %v, want 4 项", got)
		}
		for _, p := range got {
			if !want[p] {
				t.Errorf("意外的参数 %q", p)
			}
			if p == "include_reasoning" || p == "temperature" || p == "top_p" {
				t.Errorf("宣告了本仓不处理的参数 %q", p)
			}
		}
		reasoning, _ := e["reasoning"].(map[string]any)
		if reasoning["mandatory"] != true {
			t.Errorf("can_disable_thinking=false ⇒ mandatory 必须为 true，实际 %v", reasoning["mandatory"])
		}
	})

	t.Run("仅工具", func(t *testing.T) {
		e := buildModelEntry(provider.WorkBuddy, provider.ModelInfo{ID: "m", SupportsTools: true})
		got := strings.Join(paramsOf(e), ",")
		if got != "tools,tool_choice" {
			t.Fatalf("supported_parameters = %q", got)
		}
		if _, ok := e["reasoning"]; ok {
			t.Error("未声明档位时不得出现 reasoning 对象")
		}
	})

	t.Run("仅档位且可关闭思考", func(t *testing.T) {
		e := buildModelEntry(provider.WorkBuddy, provider.ModelInfo{
			ID: "m", ReasoningEfforts: []string{"medium"}, CanDisableThinking: &yes,
		})
		got := strings.Join(paramsOf(e), ",")
		if got != "reasoning,reasoning_effort" {
			t.Fatalf("supported_parameters = %q", got)
		}
		reasoning, _ := e["reasoning"].(map[string]any)
		if reasoning["mandatory"] != false {
			t.Errorf("can_disable_thinking=true ⇒ mandatory 必须为 false，实际 %v", reasoning["mandatory"])
		}
	})

	t.Run("未声明档位三态", func(t *testing.T) {
		e := buildModelEntry(provider.WorkBuddy, provider.ModelInfo{
			ID: "m", ReasoningEfforts: []string{"medium"}, CanDisableThinking: nil,
		})
		reasoning, _ := e["reasoning"].(map[string]any)
		if _, ok := reasoning["mandatory"]; ok {
			t.Error("上游未声明 can_disable_thinking 时不得输出 mandatory（会变成脑补）")
		}
		if _, ok := reasoning["can_disable_thinking"]; ok {
			t.Error("未声明时不得输出 can_disable_thinking")
		}
	})

	t.Run("都没有", func(t *testing.T) {
		e := buildModelEntry(provider.WorkBuddy, provider.ModelInfo{ID: "m"})
		if _, ok := e["supported_parameters"]; ok {
			t.Fatalf("两者皆无时 supported_parameters 必须缺席，实际 %v", e["supported_parameters"])
		}
	})
}
