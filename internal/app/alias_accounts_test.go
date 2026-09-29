package app

import (
	"path/filepath"
	"testing"
	"time"

	"wild-work/internal/auth"
	"wild-work/internal/config"
	"wild-work/internal/pool"
	"wild-work/internal/provider"
)

// newAliasApp 复刻 cmd/wild-work/main.go 的装配形态：TraeCode 与 TraeWork 共用
// 同一个 pool，且 TraeCode 标记 Alias。返回两个 fakeUpstream 以便分别计数调用次数。
func newAliasApp(t *testing.T, uids []string) (*App, *fakeUpstream, *fakeUpstream) {
	t.Helper()
	dir := t.TempDir()
	cfg := config.Default()
	cfg.StateFile = filepath.Join(dir, "state.json")
	cfg.AuthDir = dir

	trUp := &fakeUpstream{remain: 1000}
	codeUp := &fakeUpstream{remain: 1000}

	p := pool.New(filepath.Join(dir, "state-traework.json"))
	// ExpiresAt 置远：避免刷新路径触发 token refresh + SaveAtomic（凭证无 FilePath）
	exp := time.Now().Add(24 * time.Hour).Unix()
	for _, uid := range uids {
		p.Add(&auth.Auth{Kind: provider.TraeWork.String(), UID: uid, AccessToken: "t", RefreshToken: "r", ExpiresAt: exp})
	}

	a, err := New(Options{
		ConfigPath: filepath.Join(dir, "config.json"),
		Config:     cfg,
		Runtimes: map[provider.Kind]*Runtime{
			provider.TraeWork: {Kind: provider.TraeWork, Pool: p, Upstream: trUp},
			provider.TraeCode: {Kind: provider.TraeCode, Pool: p, Upstream: codeUp, Alias: true},
		},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.Close)
	return a, trUp, codeUp
}

var aliasUIDs = []string{"1096659538811594", "2666795683550651", "2099000000000001"}

// TestAliasChannelNotDoubleCounted 共用 pool 的别名渠道不得让账号条目翻倍。
// 回归的现象：面板上每个 TraeWork 账号出现两张卡片（9 张卡片 vs 日志 7 个账号）。
func TestAliasChannelNotDoubleCounted(t *testing.T) {
	a, _, _ := newAliasApp(t, aliasUIDs)

	if got := a.totalAccounts(); got != len(aliasUIDs) {
		t.Errorf("totalAccounts = %d, want %d", got, len(aliasUIDs))
	}
	if got := len(a.allStatuses()); got != len(aliasUIDs) {
		t.Errorf("allStatuses = %d 条, want %d", got, len(aliasUIDs))
	}

	views := a.accountViews()
	if len(views) != len(aliasUIDs) {
		t.Fatalf("accountViews = %d 条, want %d", len(views), len(aliasUIDs))
	}
	seen := map[string]bool{}
	for _, v := range views {
		if seen[v.UID] {
			t.Errorf("uid %s 重复出现", v.UID)
		}
		seen[v.UID] = true
		if v.Group != provider.TraeWork.String() {
			t.Errorf("uid %s group = %q, want %q", v.UID, v.Group, provider.TraeWork)
		}
	}

	// /api/state 是面板数据源，直接验证对外口径
	st := a.GetState()
	if len(st.Accounts) != len(aliasUIDs) {
		t.Errorf("GetState().Accounts = %d 条, want %d", len(st.Accounts), len(aliasUIDs))
	}
}

// TestFindRuntimeAuthPrefersMainChannel 账号级反查必须恒定命中主渠道。
// map 遍历序随机，别名渠道不排除时「归属哪个 runtime」每次 range 都可能翻转，
// 后果是刷新积分/明细/删除/停用误用 function=solo_agent 的 upstream。
func TestFindRuntimeAuthPrefersMainChannel(t *testing.T) {
	a, _, _ := newAliasApp(t, aliasUIDs)

	// 重复遍历以覆盖 Go 对 map 迭代起点的随机化
	for i := 0; i < 200; i++ {
		for _, uid := range aliasUIDs {
			rt, au := a.findRuntimeAuth(uid)
			if rt == nil || au == nil {
				t.Fatalf("findRuntimeAuth(%s) 未命中", uid)
			}
			if rt.Kind != provider.TraeWork {
				t.Fatalf("uid %s 归属 %s，应为 %s（第 %d 轮）", uid, rt.Kind, provider.TraeWork, i)
			}
			if g := a.accountGroup(uid); g != provider.TraeWork.String() {
				t.Fatalf("uid %s accountGroup = %q, want %q", uid, g, provider.TraeWork)
			}
		}
	}
}

// TestRefreshAllSkipsAliasChannel 全量刷积分不应对同一批账号打两次上游，
// 汇总数也不应把别名渠道单独计一笔。
func TestRefreshAllSkipsAliasChannel(t *testing.T) {
	a, trUp, codeUp := newAliasApp(t, aliasUIDs)

	sum := a.RefreshAll()
	if sum.Total != len(aliasUIDs) {
		t.Errorf("RefreshAll Total = %d, want %d", sum.Total, len(aliasUIDs))
	}
	if got := trUp.resourceCalls.Load(); got != int32(len(aliasUIDs)) {
		t.Errorf("TraeWork upstream 调用 %d 次, want %d", got, len(aliasUIDs))
	}
	if got := codeUp.resourceCalls.Load(); got != 0 {
		t.Errorf("别名渠道 upstream 被调用 %d 次, want 0", got)
	}
	if _, ok := sum.Platforms[provider.TraeCode.String()]; ok {
		t.Errorf("汇总出现别名渠道条目 %v, 应只有 %s", sum.Platforms, provider.TraeWork)
	}
}

// TestAliasChannelStillAdvertised 去重只针对账号口径：别名渠道作为可选渠道/
// 模型前缀必须仍然存在（旧 Qoder 之外唯一保留的路由型渠道，费率表也需分列）。
func TestAliasChannelStillAdvertised(t *testing.T) {
	a, _, _ := newAliasApp(t, aliasUIDs)

	st := a.GetState()
	found := false
	for _, c := range st.Compat.Channels {
		if c == provider.TraeCode.String() {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Compat.Channels = %v, 缺少 %s（账号去重不应影响渠道路由入口）", st.Compat.Channels, provider.TraeCode)
	}
}
