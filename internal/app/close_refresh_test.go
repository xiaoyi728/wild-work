// close_refresh_test.go 锁住「Close 必须等积分刷新收尾」这条退出纪律。
//
// 背景（2026-11-04，PR #215 作者在 issue 里点名）：SetExpiringDays 末尾是
// `go a.RefreshAll()`，刷新链路会往回写 pool 快照 / ledger / stats，并在写的过程中
// **重新创建 data 目录**。若 Close 不等它，进程退出（或测试 TempDir 清理）就会与
// 后台 goroutine 抢同一批文件句柄：Windows 上表现为
// `RemoveAll cleanup: ... directory is not empty`，面板侧则可能留下半截 state.json。
package app

import (
	"sync"
	"testing"
	"time"

	"wild-work/internal/auth"
	"wild-work/internal/provider"
)

// slowItemsUpstream 在 UserResourceDetail 里阻塞到 release 关闭，
// 用于把「刷新进行中」这个窗口拉长到可观测。
type slowItemsUpstream struct {
	fakeUpstream
	release   chan struct{}
	entered   chan struct{}
	enterOnce sync.Once
}

func (s *slowItemsUpstream) UserResourceDetail(_ *auth.Auth) (int64, []provider.ResourceItem, error) {
	s.enterOnce.Do(func() { close(s.entered) })
	<-s.release
	return 100, []provider.ResourceItem{{Name: "pkg", Remain: 100, Usable: true}}, nil
}

// TestCloseWaitsForRunningRefresh Close 必须阻塞到在跑的 RefreshAll 落地。
// 否则刷新会在 Close 关掉句柄之后继续往 data 目录写文件。
func TestCloseWaitsForRunningRefresh(t *testing.T) {
	up := &slowItemsUpstream{release: make(chan struct{}), entered: make(chan struct{})}
	a, _ := newTestApp(t, provider.WorkBuddyAI, up, "uid-1")

	go func() { a.RefreshAll() }()
	select {
	case <-up.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("刷新没有进入 UserResourceDetail（测试装置失效）")
	}

	closed := make(chan struct{})
	go func() { a.Close(); close(closed) }()

	// Close 不得在上游还卡着的时候就返回。
	select {
	case <-closed:
		t.Fatal("Close 在上游刷新未收尾时就返回了 —— 后台会继续写已关闭的 data 目录")
	case <-time.After(150 * time.Millisecond):
		// 期望路径：Close 仍在 waitRefresh 里等
	}

	close(up.release) // 放行上游
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("放行上游后 Close 仍未返回")
	}
}

// TestRefreshAllRejectsAfterClose closed 置位后刷新一律拒绝：
// 后台 goroutine 若还没被调度到 Close 之后才真正跑起来，会重新 MkdirAll 出 data 目录。
func TestRefreshAllRejectsAfterClose(t *testing.T) {
	up := &fakeUpstream{}
	a, _ := newTestApp(t, provider.WorkBuddyAI, up, "uid-1")
	a.Close()

	sum := a.RefreshAll()
	if !sum.Busy {
		t.Fatal("Close 之后 RefreshAll 应返回 Busy（拒绝执行），实际跑了起来")
	}
	if got := up.resourceCalls.Load(); got != 0 {
		t.Errorf("Close 之后仍打了 %d 次上游余额端点", got)
	}
}
