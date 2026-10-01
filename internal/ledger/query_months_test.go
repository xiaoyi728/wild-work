package ledger

import (
	"reflect"
	"testing"
	"time"
)

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
