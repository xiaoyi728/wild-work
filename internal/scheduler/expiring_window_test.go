package scheduler

import (
	"testing"

	"wild-work/internal/provider"
)

// TestExpiringDaysDefault 未配置（0）时回 provider 默认值（1 = 今日到期）。
func TestExpiringDaysDefault(t *testing.T) {
	s := New(Config{Name: "t"})
	if got := s.ExpiringDays(); got != provider.ExpiringDays {
		t.Errorf("未配置时 ExpiringDays() = %d, want %d", got, provider.ExpiringDays)
	}
}

// TestSetExpiringDays 运行中更新口径，读回一致（R112b）。
func TestSetExpiringDays(t *testing.T) {
	s := New(Config{Name: "t"})
	for _, d := range []int{1, 2, 7} {
		s.SetExpiringDays(d)
		if got := s.ExpiringDays(); got != d {
			t.Errorf("SetExpiringDays(%d) 后读回 %d", d, got)
		}
	}
}

// TestSetExpiringDaysZeroFallsBack 显式设 0 视同未配置 ⇒ 回 provider 默认。
func TestSetExpiringDaysZeroFallsBack(t *testing.T) {
	s := New(Config{Name: "t", ExpiringDays: 7})
	s.SetExpiringDays(0)
	if got := s.ExpiringDays(); got != provider.ExpiringDays {
		t.Errorf("设 0 后应回默认 %d，实得 %d", provider.ExpiringDays, got)
	}
}

// TestExpiringDaysFromConfig 构造时带值即生效（main 装配路径）。
func TestExpiringDaysFromConfig(t *testing.T) {
	s := New(Config{Name: "t", ExpiringDays: 7})
	if got := s.ExpiringDays(); got != 7 {
		t.Errorf("ExpiringDays = %d, want 7", got)
	}
}
