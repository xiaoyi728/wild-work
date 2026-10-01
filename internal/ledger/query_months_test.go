package ledger

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// TestPrevMonthCutoffAnchoredToFirst 锁死 cleanup 保留下界「不会等于当月」。
//
// 判据同样做在纯函数上：端到端只在每月那几天复现（2026 年是 3/29·30·31、5/31、
// 7/31、10/31、12/31 共 7 天），其余日子假绿。期望值一律写字面量，不用同一套加法反算，
// 否则测试与实现同错就永远绿。
func TestPrevMonthCutoffAnchoredToFirst(t *testing.T) {
	cases := []struct{ day, want string }{
		// 溢出组：上个月天数不够，AddDate 会归一化到当月之后
		{"2026-03-29", "202602"}, {"2026-03-30", "202602"}, {"2026-03-31", "202602"},
		{"2026-05-31", "202604"}, {"2026-07-31", "202606"}, {"2026-10-31", "202609"},
		{"2026-12-31", "202611"},
		// 对照与边界
		{"2026-10-01", "202609"}, {"2026-06-15", "202605"}, {"2026-01-31", "202512"},
		{"2028-02-29", "202801"}, // 闰日
		{"2028-03-31", "202802"}, // 闰年 2 月有 29 天：3/29 不再溢出，3/31 仍会
	}
	for _, c := range cases {
		now, err := time.Parse("2006-01-02", c.day)
		if err != nil {
			t.Fatalf("用例日期无效：%v", err)
		}
		now = now.In(time.Local)
		if got := prevMonthCutoff(now); got != c.want {
			t.Errorf("prevMonthCutoff(%s) = %s，期望 %s", c.day, got, c.want)
		}
	}
}

// TestCleanupKeepsPrevMonthToday 端到端补一刀真实的删除路径：以**今天**为基准建 Ledger，
// 上月分段必须活下来（更早的不该留）。它是纯函数表的对照面——表管「哪几天会错」，
// 这条管「删除逻辑本身有没有被改坏」，例如有人动了 keepMonths 或文件名的月份截取。
func TestCleanupKeepsPrevMonthToday(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "ledger")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	prev := first.AddDate(0, -1, 0).Format("200601")
	ancient := first.AddDate(0, -3, 0).Format("200601")
	for _, k := range []string{prev, ancient} {
		if err := os.WriteFile(filepath.Join(dir, "usage-"+k+".jsonl"), []byte("{}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	l, err := New(dir) // New 内部就会 cleanup()
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	if _, err := os.Stat(filepath.Join(dir, "usage-"+prev+".jsonl")); err != nil {
		t.Errorf("上月分段 usage-%s.jsonl 被 cleanup 删掉了（今天=%s，cutoff=%s）：%v",
			prev, now.Format("2006-01-02"), prevMonthCutoff(now), err)
	}
	if _, err := os.Stat(filepath.Join(dir, "usage-"+ancient+".jsonl")); err == nil {
		t.Errorf("三个月前的 usage-%s.jsonl 本该被删掉却还在", ancient)
	}
}

// TestMonthSegmentsCrossMonthWindow 锁死「7 日窗口跨月时当月分段必须进集合」。
//
// 判据是纯函数而非端到端：Query 用 time.Now()，端到端写法只有在每月头 14 天才复现，
// 其余日子会假绿——那正是这个缺陷原本的形态（它一直绿到当月第一天）。
func TestMonthSegmentsCrossMonthWindow(t *testing.T) {
	at := func(y int, mo time.Month, d int) time.Time {
		return time.Date(y, mo, d, 9, 30, 0, 0, time.Local)
	}
	cases := []struct {
		name string
		from time.Time
		now  time.Time
		want []string
	}{
		{"同月窗口", at(2026, time.October, 1), at(2026, time.October, 7), []string{"202610"}},
		{"跨到当月 1 日（旧写法漏掉当月）", at(2026, time.September, 25), at(2026, time.October, 1), []string{"202609", "202610"}},
		{"跨到当月 14 日（旧写法仍漏）", at(2026, time.September, 30), at(2026, time.October, 14), []string{"202609", "202610"}},
		{"跨年", at(2026, time.December, 26), at(2027, time.January, 2), []string{"202612", "202701"}},
		{"跨三个月", at(2026, time.August, 31), at(2026, time.October, 2), []string{"202608", "202609", "202610"}},
		// now 落在月初 00:00 整点：当月分段起点与 now 相等，不能被 !m.After(now) 判出去
		{"now 恰为月初零点", at(2026, time.August, 20), time.Date(2026, time.September, 1, 0, 0, 0, 0, time.Local), []string{"202608", "202609"}},
	}
	for _, c := range cases {
		got := monthSegments(c.from, c.now)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: monthSegments(%s, %s) = %v，期望 %v", c.name,
				c.from.Format("2006-01-02"), c.now.Format("2006-01-02"), got, c.want)
		}
	}
}
