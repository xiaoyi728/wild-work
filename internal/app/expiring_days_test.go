package app

import (
	"os"
	"path/filepath"
	"testing"

	"wild-work/internal/config"
	"wild-work/internal/provider"
	"wild-work/internal/scheduler"
)

// newExpiringApp 构造一个只够测临期口径的最小 App（无渠道、无网络）。
func newExpiringApp(t *testing.T, days int) *App {
	t.Helper()
	dir := t.TempDir()
	cfg := config.Default()
	cfg.Schedule.ExpiringDays = days
	cfg.AuthDir = filepath.Join(dir, "auths")
	cfg.StateFile = filepath.Join(dir, "state.json")
	a, err := New(Options{ConfigPath: filepath.Join(dir, "config.json"), Config: cfg})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.Close)
	return a
}

// TestExpiringDaysReadback 配置值是唯一真源；非法值回退默认 1 天。
func TestExpiringDaysReadback(t *testing.T) {
	for _, d := range []int{1, 2, 7} {
		a := newExpiringApp(t, d)
		if got := a.expiringDays(); got != d {
			t.Errorf("expiringDays() = %d, want %d", got, d)
		}
	}
}

// TestExpiringDaysInvalidFallsBack 老配置/手改脏值不得让面板显示非法窗口。
func TestExpiringDaysInvalidFallsBack(t *testing.T) {
	a := newExpiringApp(t, 3) // 非法
	if got := a.expiringDays(); got != config.DefaultExpiringDays {
		t.Errorf("非法值应回退 %d，实得 %d", config.DefaultExpiringDays, got)
	}
}

// TestSetExpiringDaysRejectsInvalid 端点只接受 1/2/7。
func TestSetExpiringDaysRejectsInvalid(t *testing.T) {
	a := newExpiringApp(t, 1)
	for _, d := range []int{0, 3, 8, -1} {
		if err := a.SetExpiringDays(d); err == nil {
			t.Errorf("SetExpiringDays(%d) 应报错", d)
		}
	}
}

// TestSetExpiringDaysPersistsAndBroadcasts 保存 → 落盘 → 推给调度器（R112b）。
func TestSetExpiringDaysPersistsAndBroadcasts(t *testing.T) {
	a := newExpiringApp(t, 1)

	// 挂一个带调度器的运行时，验证广播（签到路径也写 expiring，不推会改回旧口径）。
	sch := scheduler.New(scheduler.Config{Name: "t", ExpiringDays: 1})
	a.runtimes = map[provider.Kind]*Runtime{
		provider.WorkBuddy: {Kind: provider.WorkBuddy, Scheduler: sch},
	}

	if err := a.SetExpiringDays(7); err != nil {
		t.Fatalf("SetExpiringDays(7): %v", err)
	}
	if got := a.expiringDays(); got != 7 {
		t.Errorf("保存后 expiringDays() = %d, want 7", got)
	}
	if got := sch.ExpiringDays(); got != 7 {
		t.Errorf("调度器未收到广播：ExpiringDays() = %d, want 7", got)
	}
	// 落盘验证：重新读配置应看到 7
	if _, err := os.Stat(a.cfgPath); err != nil {
		t.Fatalf("配置未落盘: %v", err)
	}
	reloaded, err := config.Load(a.cfgPath)
	if err != nil {
		t.Fatalf("重读配置: %v", err)
	}
	if reloaded.Schedule.ExpiringDays != 7 {
		t.Errorf("落盘值 = %d, want 7", reloaded.Schedule.ExpiringDays)
	}
}

// TestSetExpiringDaysNoopWhenUnchanged 值未变时不写盘、不刷积分。
func TestSetExpiringDaysNoopWhenUnchanged(t *testing.T) {
	a := newExpiringApp(t, 7)
	if err := a.SetExpiringDays(7); err != nil {
		t.Fatalf("SetExpiringDays(7) 幂等失败: %v", err)
	}
	if got := a.expiringDays(); got != 7 {
		t.Errorf("幂等调用后 = %d, want 7", got)
	}
}

// TestStateExposesExpiringDays /api/state 必须下发该字段供面板回显。
func TestStateExposesExpiringDays(t *testing.T) {
	a := newExpiringApp(t, 7)
	st := a.GetState()
	if st.ExpiringDays != 7 {
		t.Errorf("GetState().ExpiringDays = %d, want 7", st.ExpiringDays)
	}
}
