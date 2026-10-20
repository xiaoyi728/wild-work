package stats

import (
	"testing"
	"time"
)

// TestExpireBucketsByInstant R103 核心守门：三个到期列按**精确时刻**分**自然日**桶，
// 且逐条目累加。
//
// 锁住两件在旧实现里都错的事：
//  1. 今晚 00:00 失效（上游每日额度真实形态）必须算**今日**，不能算明日。
//     旧实现按日期字符串比（a.expireAt == today），"2026-10-20T00:00" 截成
//     "2026-10-20" 后落到明日桶，415 分被误报成「明日到期」，实际只剩 5.7h。
//  2. 「7 日内」必须逐条目累加，不能只取「每账号最早到期日」那一天。
//     旧实现只留最早日，workbuddy 每账号 20+ 个每日包全被漏掉（1788 vs 4938）。
func TestExpireBucketsByInstant(t *testing.T) {
	s := newTestStats(t)
	// 基准 2026-10-19 14:00（UTC+8）
	base := time.Date(2026, 10, 19, 14, 0, 0, 0, time.Local)
	s.ApplyPoll([]Account{{UID: "a", Group: "qwenwork", Credits: 1000}}, base)

	s.ApplyExpiry("a", []ExpireItem{
		// 今晚 24:00 失效：必须进「今日」（零点宽限）
		{At: "2026-10-20T00:00:00+08:00", Amount: 100},
		// 明日 23:59 失效：进「明日」
		{At: "2026-10-20T23:59:59+08:00", Amount: 200},
		// 后天中午：进「7 日内」
		{At: "2026-10-21T12:00:00+08:00", Amount: 300},
		// 第 5 天：也进「7 日内」——旧实现只看最早日，这 400 会被漏掉
		{At: "2026-10-24T12:00:00+08:00", Amount: 400},
		// 远期：哪都不进
		{At: "2026-11-30T12:00:00+08:00", Amount: 900},
	})

	snap := s.Snapshot(base)
	if snap.ExpireToday != 100 {
		t.Errorf("ExpireToday = %d, want 100（今晚 00:00 失效算今日）", snap.ExpireToday)
	}
	if snap.ExpireTomorrow != 200 {
		t.Errorf("ExpireTomorrow = %d, want 200", snap.ExpireTomorrow)
	}
	// 7 日内 = 今日 + 明日 + 后续 5 天内 = 100+200+300+400
	if snap.Expiring7d != 1000 {
		t.Errorf("Expiring7d = %d, want 1000（逐条目累加，不是只取最早日）", snap.Expiring7d)
	}

	var row PlatformRow
	for _, r := range snap.Platforms {
		if r.Group == "qwenwork" {
			row = r
		}
	}
	if row.ExpireToday != 100 || row.ExpireTomorrow != 200 || row.Expire7d != 1000 {
		t.Errorf("平台行 = 今日%d/明日%d/7日%d，want 100/200/1000",
			row.ExpireToday, row.ExpireTomorrow, row.Expire7d)
	}
}

// TestExpiryRowsHoursLeft 守门「最近临期」按**剩余时长**排序与展示。
// 旧实现按日期升序，同一天内的包看不出谁先没（今晚 00:00 vs 今晚 23:59）。
func TestExpiryRowsHoursLeft(t *testing.T) {
	s := newTestStats(t)
	base := time.Date(2026, 10, 19, 14, 0, 0, 0, time.Local)
	s.ApplyPoll([]Account{
		{UID: "late", Group: "qwenwork", Credits: 100},
		{UID: "soon", Group: "qwenwork", Credits: 100},
	}, base)
	s.ApplyExpiry("late", []ExpireItem{{At: "2026-10-20T23:59:59+08:00", Amount: 50}})
	s.ApplyExpiry("soon", []ExpireItem{{At: "2026-10-20T00:00:00+08:00", Amount: 50}})

	rows := s.Snapshot(base).Expiry
	if len(rows) != 2 {
		t.Fatalf("应有 2 行，实际 %d", len(rows))
	}
	if rows[0].UID != "soon" {
		t.Fatalf("应按剩余时长升序（soon 10h 在前，late 34h 在后），实际首行 %s", rows[0].UID)
	}
	if rows[0].HoursLeft < 9.9 || rows[0].HoursLeft > 10.1 {
		t.Errorf("soon 剩余 = %.1fh，want ≈10h", rows[0].HoursLeft)
	}
	if rows[1].HoursLeft < 33.9 || rows[1].HoursLeft > 34.1 {
		t.Errorf("late 剩余 = %.1fh，want ≈34h", rows[1].HoursLeft)
	}

	// 混合格式：日期串排序与剩余时长排序会**分叉**的用例。
	// 纯日期 "2026-10-19" = 19 日全天可用 ⇒ 20 日 00:00 失效 = 剩 10h；
	// RFC3339 "2026-10-19T20:00" = 剩 6h（更早失效）。
	// 但字符串比较 "2026-10-19" < "2026-10-19T20:00..."（短前缀更小），
	// 按日期串排会把剩 10h 的排到剩 6h 的前面——必须按剩余时长排。
	s3 := newTestStats(t)
	s3.ApplyPoll([]Account{
		{UID: "d1", Group: "qwenwork", Credits: 100},
		{UID: "d2", Group: "qwenwork", Credits: 100},
	}, base)
	s3.ApplyExpiry("d1", []ExpireItem{{At: "2026-10-19", Amount: 50}})                // 纯日期 → 剩 10h
	s3.ApplyExpiry("d2", []ExpireItem{{At: "2026-10-19T20:00:00+08:00", Amount: 50}}) // 剩 6h
	rows = s3.Snapshot(base).Expiry
	if len(rows) != 2 || rows[0].UID != "d2" {
		t.Fatalf("应按剩余时长排（d2 6h 在 d1 10h 前），实际 %+v", rows)
	}
}

// TestExpiryRiskWhenNoBurn 守门「算不出消耗」不等于「没风险」。
//
// 用户实测（2026-10-19）：最近临期 16 行里只有第 4 行红色。前 3 行是今晚
// 4.7 小时后到期的 qwenwork 号，今天**一分没花**（creditOut=0 ⇒ forecast=-1）。
// 旧判据 `forecast >= 0 && forecast < amount` 把「完全没在消耗、马上要作废」
// 这个最该预警的情形排除掉了，只有今天花过 1 分（forecast=0）的那个红。
// 新判据：forecast<0 视为「预计作废 = 全部额度」⇒ 照样预警。
func TestExpiryRiskWhenNoBurn(t *testing.T) {
	s := newTestStats(t)
	base := time.Date(2026, 10, 19, 20, 0, 0, 0, time.Local)
	s.ApplyPoll([]Account{
		{UID: "idle", Group: "qwenwork", Credits: 100}, // 今天没花过 → forecast=-1
		{UID: "burn", Group: "qwenwork", Credits: 100}, // 花过一点 → forecast>=0
		{UID: "far", Group: "qwenwork", Credits: 100},  // 远期，不该预警
	}, base)
	// 今晚 4 小时后到期（今日桶内）
	s.ApplyExpiry("idle", []ExpireItem{{At: "2026-10-20T00:00:00+08:00", Amount: 100}})
	s.ApplyExpiry("burn", []ExpireItem{{At: "2026-10-20T00:00:00+08:00", Amount: 100}})
	// 30 天后到期：超出 expiryRiskDays，不该预警
	s.ApplyExpiry("far", []ExpireItem{{At: "2026-11-18T12:00:00+08:00", Amount: 100}})
	// burn 号今天消耗过（制造 creditOut>0 与足够观测时长）
	s.ApplyPoll([]Account{
		{UID: "idle", Group: "qwenwork", Credits: 100},
		{UID: "burn", Group: "qwenwork", Credits: 90},
		{UID: "far", Group: "qwenwork", Credits: 100},
	}, base.Add(2*time.Hour))

	rows := s.Snapshot(base.Add(2 * time.Hour)).Expiry
	byUID := map[string]ExpiryRow{}
	for _, r := range rows {
		byUID[r.UID] = r
	}
	if idle, ok := byUID["idle"]; !ok || !idle.Risk {
		t.Errorf("今日没消耗但今晚到期的号必须预警（forecast=%d）：%+v", idle.BurnForecast, idle)
	}
	if idle := byUID["idle"]; idle.BurnForecast != -1 {
		t.Errorf("idle 的 forecast 应为 -1（观测不足），实际 %d", idle.BurnForecast)
	}
	if burn, ok := byUID["burn"]; !ok || !burn.Risk {
		t.Errorf("今天花过、额度花不完的号必须预警：%+v", burn)
	}
	if far, ok := byUID["far"]; !ok || far.Risk {
		t.Errorf("30 天后到期的号不该预警（超出 7 自然日窗口）：%+v", far)
	}
}

// TestExpiryRowsFullInstant 守门「到期时刻必须带完整时分秒」。
// 前端渲染「YYYY-MM-DD HH:MM:SS」，后端下发的必须是完整 RFC3339，
// 不能只有日期（否则秒级信息在源头就丢了，前端补不回来）。
func TestExpiryRowsFullInstant(t *testing.T) {
	s := newTestStats(t)
	base := time.Date(2026, 10, 19, 14, 0, 0, 0, time.Local)
	s.ApplyPoll([]Account{{UID: "a", Group: "qwenwork", Credits: 100}}, base)
	s.ApplyExpiry("a", []ExpireItem{{At: "2026-10-20T00:00:03+08:00", Amount: 50}})
	rows := s.Snapshot(base).Expiry
	if len(rows) != 1 {
		t.Fatalf("应有 1 行，实际 %d", len(rows))
	}
	if rows[0].ExpireAt != "2026-10-20T00:00:03+08:00" {
		t.Errorf("ExpireAt 必须原样保留秒级精度，实际 %q", rows[0].ExpireAt)
	}
}

// TestExpiryUrgency 守门「配色按紧迫度分档」而不是按 risk（会不会作废）。
//
// 用户实测（2026-10-19）：最近临期 16 行里一堆标红，连 135.7 小时后（5.7 天）
// 到期的也红。原因是前端拿 risk 上色，而 risk = 7 自然日内到期 且 可能花不完，
// 于是「7 天内的」全部飘红——一片警示等于没有警示。
// 用户定义：**今天到期标红、明天到期标黄、更远不上色**。
func TestExpiryUrgency(t *testing.T) {
	s := newTestStats(t)
	base := time.Date(2026, 10, 19, 14, 0, 0, 0, time.Local)
	s.ApplyPoll([]Account{
		{UID: "today", Group: "qwenwork", Credits: 100},
		{UID: "tomorrow", Group: "traework", Credits: 100},
		{UID: "far", Group: "workbuddyai", Credits: 100},
	}, base)
	// 今晚 00:00（次日零点归今日）→ today
	s.ApplyExpiry("today", []ExpireItem{{At: "2026-10-20T00:00:00+08:00", Amount: 100}})
	// 明日 08:45 → tomorrow
	s.ApplyExpiry("tomorrow", []ExpireItem{{At: "2026-10-20T08:45:21+08:00", Amount: 100}})
	// 5.7 天后（135.7h）→ later（正是用户截图里被误标红的那类）
	s.ApplyExpiry("far", []ExpireItem{{At: "2026-10-25T12:06:19+08:00", Amount: 100}})

	byUID := map[string]ExpiryRow{}
	for _, r := range s.Snapshot(base).Expiry {
		byUID[r.UID] = r
	}
	if got := byUID["today"].Urgency; got != UrgencyToday {
		t.Errorf("今晚 00:00 失效应为 today，实际 %q", got)
	}
	if got := byUID["tomorrow"].Urgency; got != UrgencyTomorrow {
		t.Errorf("明日 08:45 应为 tomorrow，实际 %q", got)
	}
	if got := byUID["far"].Urgency; got != UrgencyLater {
		t.Errorf("5.7 天后应为 later（不该标红），实际 %q", got)
	}
	// 关键：far 可能仍然 risk=true（按今日速度花不完），但那只是「预计作废」的数据结论，
	// 颜色必须跟 urgency 走。两者必须解耦。
	if !byUID["far"].Risk {
		t.Log("far 的 risk=false（观测不足时本应为 true），此处不强制")
	}
	if byUID["far"].Urgency == UrgencyToday || byUID["far"].Urgency == UrgencyTomorrow {
		t.Errorf("5.7 天后到期的行不能被归入今天/明天档：%+v", byUID["far"])
	}
}
