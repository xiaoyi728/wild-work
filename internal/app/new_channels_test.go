package app

import (
	"os"
	"strings"
	"testing"
	"time"

	"wild-work/internal/provider"
)

// 本文件锁住 2026-11-17 接入 doubao / lingxi 时最容易漏的几处接线。
// 这些缺陷的共同特征是「不报错、不崩溃」：账号能加、面板能看到，
// 但重启后消失、签到不跑、或重登入口点不动。

// TestReloadAccountsCoversNewChannels 扫码/粘贴落盘后必须 reload 进池。
// 漏了的表现：日志说「账号已添加」，面板就是没有（上游 2026-11-15 真实踩过）。
func TestReloadAccountsCoversNewChannels(t *testing.T) {
	src, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatalf("读 app.go 失败: %v", err)
	}
	code := string(src)
	start := strings.Index(code, "func (a *App) reloadAccounts(")
	if start < 0 {
		t.Fatal("未找到 reloadAccounts（重构了？本测试需同步更新）")
	}
	rest := code[start:]
	if end := strings.Index(rest, "\nfunc "); end > 0 {
		rest = rest[:end]
	}
	for _, want := range []string{
		"provider.Doubao",
		"provider.Lingxi",
		"reload doubao accounts",
		"reload lingxi accounts",
	} {
		if !strings.Contains(rest, want) {
			t.Errorf("reloadAccounts 缺 %q —— 新账号落盘后不会进池，面板要等重启才可见", want)
		}
	}
}

// TestNewChannelsSupportCheckin 两个渠道都有每日签到，不得被 noExplicitCheckin 拦掉。
func TestNewChannelsSupportCheckin(t *testing.T) {
	for _, k := range []provider.Kind{provider.Doubao, provider.Lingxi} {
		if noExplicitCheckin(k) {
			t.Errorf("%s 有每日签到，却被 noExplicitCheckin 判为不支持手动签到", k)
		}
	}
}

// TestLingxiLoginTimeout 灵犀 CDP 等待上限必须覆盖通用 5 分钟：
// 否则 pollLogin 会先到、把还在等用户登录的浏览器关掉。
func TestLingxiLoginTimeout(t *testing.T) {
	if got := loginTimeoutFor(provider.Lingxi); got <= loginTimeout {
		t.Fatalf("Lingxi 登录等待 = %v，必须大于通用 %v", got, loginTimeout)
	}
	if got := loginTimeoutFor(provider.WorkBuddy); got != loginTimeout {
		t.Fatalf("普通渠道等待被误改：%v", got)
	}
	if got := loginTimeoutFor(provider.Lingxi); got < 10*time.Minute {
		t.Fatalf("Lingxi 等待 = %v，应至少覆盖 CDP 的 10 分钟等待", got)
	}
}

// TestDoubaoDoesNotUseGenericLogin 豆包必须走扫码弹层；通用 /api/login/start
// 若静默走 OAuth 会打开一个没有任何回调的浏览器，用户永远等不到账号。
func TestDoubaoDoesNotUseGenericLogin(t *testing.T) {
	a := &App{}
	if _, err := a.StartLoginFor("doubao"); err == nil {
		t.Fatal("doubao 不应复用通用登录流程，应提示使用扫码弹层")
	}
}

// TestCredentialValidatorsRejectEmpty 两个新渠道的入口在空凭据时必须在本地
// 直接拒绝（不发上游请求、不写入半截 auth 文件）。
func TestCredentialValidatorsRejectEmpty(t *testing.T) {
	a := &App{}
	if _, _, err := a.SubmitDoubaoCookie("  "); err == nil {
		t.Fatal("空豆包 Cookie 必须被拒绝")
	}
	if _, _, err := a.SubmitLingxiSID("  "); err == nil {
		t.Fatal("空 wps_sid 必须被拒绝")
	}
}
