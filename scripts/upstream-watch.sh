#!/usr/bin/env bash
# 上游更新监测（只读）。
#   daily  : 检查 rockswang/wild-work 的 master 是否变化；有变化才 fetch 并生成差异报告，
#            无变化只写一行运行日志。
#   weekly : 固定生成一份周报（即使无变化），并推进周基线。
# 不合并、不切换分支、不碰工作区；唯一写操作是 git fetch 更新 refs/remotes/upstream/master
# 与本目录下的报告/状态文件。
# 定时：~/.config/systemd/user/wild-work-upstream-{daily,weekly}.timer
set -euo pipefail

MODE="${1:-daily}"
case "$MODE" in
  daily|weekly) ;;
  *) echo "usage: $0 daily|weekly" >&2; exit 2 ;;
esac

REPO_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
WATCH_DIR="$REPO_DIR/docs/upstream-watch"
REPORTS_DIR="$WATCH_DIR/reports"
STATE_FILE="$WATCH_DIR/state.env"
LOCK_FILE="$WATCH_DIR/.lock"
RUN_LOG="$WATCH_DIR/run.log"
UPSTREAM_URL="https://github.com/rockswang/wild-work.git"
UPSTREAM_REF="refs/heads/master"
GIT=(git -C "$REPO_DIR")

mkdir -p "$REPORTS_DIR"

exec 9>"$LOCK_FILE"
flock -n 9 || { echo "[$(date '+%F %T')] [$MODE] 已有实例在运行，跳过"; exit 0; }

# 走 stderr：stdout 留给报告生成逻辑（ensure_baseline 的结果由命令替换捕获）。
log() { printf '[%s] [%s] %s\n' "$(date '+%F %T')" "$MODE" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

LAST_SEEN_SHA=""
LAST_SEEN_AT=""
WEEKLY_BASELINE_SHA=""
WEEKLY_BASELINE_AT=""
state_existed=0
if [[ -f "$STATE_FILE" ]]; then
  state_existed=1
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi

write_state() {
  local tmp="$STATE_FILE.tmp"
  {
    printf 'LAST_SEEN_SHA=%q\n' "$LAST_SEEN_SHA"
    printf 'LAST_SEEN_AT=%q\n' "$LAST_SEEN_AT"
    printf 'WEEKLY_BASELINE_SHA=%q\n' "$WEEKLY_BASELINE_SHA"
    printf 'WEEKLY_BASELINE_AT=%q\n' "$WEEKLY_BASELINE_AT"
  } >"$tmp"
  mv "$tmp" "$STATE_FILE"
}

"${GIT[@]}" rev-parse --git-dir >/dev/null 2>&1 || die "$REPO_DIR 不是 git 仓库"
"${GIT[@]}" remote get-url upstream >/dev/null 2>&1 || die "缺少 upstream remote"

prev_ref="$("${GIT[@]}" rev-parse -q --verify refs/remotes/upstream/master 2>/dev/null || true)"
local_head="$("${GIT[@]}" rev-parse --short HEAD)"
dirty_count="$("${GIT[@]}" status --porcelain | wc -l)"

remote_sha=""
for attempt in 1 2 3; do
  remote_sha="$(timeout 60 "${GIT[@]}" ls-remote "$UPSTREAM_URL" "$UPSTREAM_REF" 2>/dev/null | awk 'NR==1{print $1}')" || true
  [[ -n "$remote_sha" ]] && break
  log "ls-remote 第 $attempt 次失败，15s 后重试"
  sleep 15
done
[[ -n "$remote_sha" ]] || die "无法访问上游 $UPSTREAM_URL（检查网络/代理）"
[[ "$remote_sha" =~ ^[0-9a-f]{40}$ ]] || die "上游返回异常: $remote_sha"

ref_sha="$("${GIT[@]}" rev-parse -q --verify refs/remotes/upstream/master 2>/dev/null || true)"
if [[ "$remote_sha" != "$ref_sha" ]]; then
  log "拉取 upstream/master: ${ref_sha:-<无>} -> $remote_sha"
  timeout 300 "${GIT[@]}" fetch --quiet --no-tags upstream master || die "git fetch 失败"
  ref_sha="$("${GIT[@]}" rev-parse -q --verify refs/remotes/upstream/master 2>/dev/null || true)"
  [[ "$remote_sha" == "$ref_sha" ]] || die "fetch 后 ref 仍不匹配（$ref_sha != $remote_sha）"
fi

# 本地状态判定：上游相对本地 HEAD 是「一致 / 已偏离 / 缺失」，另标工作区未提交。
local_status() {
  local path="$1" target="$2" out="" rc=0
  if ! "${GIT[@]}" cat-file -e "${target}:${path}" 2>/dev/null; then
    out="上游已删除"
  fi
  if ! "${GIT[@]}" cat-file -e "HEAD:${path}" 2>/dev/null; then
    out="${out:+$out；}本地无此文件"
  else
    "${GIT[@]}" diff --quiet HEAD "$target" -- "$path" || rc=$?
    case "$rc" in
      0) out="${out:+$out；}本地一致" ;;
      1) out="${out:+$out；}本地已偏离" ;;
      *) out="${out:+$out；}比较失败(rc=$rc)" ;;
    esac
  fi
  # 仅对本地存在（HEAD 或工作区）的文件查 dirty；上游新增的目录本地没有，
  # `git status -- <path>` 会逐条打「无法打开目录」的警告。
  if "${GIT[@]}" cat-file -e "HEAD:${path}" 2>/dev/null || [[ -e "$REPO_DIR/$path" ]]; then
    if [[ -n "$("${GIT[@]}" status --porcelain -- "$path" 2>/dev/null)" ]]; then
      out="${out:+$out；}工作区未提交"
    fi
  fi
  printf '%s' "$out"
}

# write_report <daily|weekly> <baseline> <target> <report-file> [备注]
write_report() {
  local kind="$1" baseline="$2" target="$3" report="$4" note="${5:-}"
  local title rewritten=0 range="" changed=()
  if [[ "$kind" == weekly ]]; then title="上游周报"; else title="上游更新报告"; fi

  if [[ -n "$baseline" ]]; then
    if "${GIT[@]}" merge-base --is-ancestor "$baseline" "$target" 2>/dev/null; then
      range="$baseline..$target"
    else
      rewritten=1
    fi
    mapfile -t changed < <("${GIT[@]}" diff --name-only "$baseline" "$target")
  fi

  {
    printf '# %s（%s）\n\n' "$title" "$(date '+%F %T %Z')"
    printf -- '- 上游仓库：%s（master）\n' "$UPSTREAM_URL"
    printf -- '- 基线：`%s`\n' "${baseline:-无}"
    printf -- '- 上游当前：`%s`\n' "$target"
    printf -- '- 本地 HEAD：`%s`（工作区未提交改动 %s 项）\n' "$local_head" "$dirty_count"
    if [[ -n "$note" ]]; then printf -- '- 说明：%s\n' "$note"; fi
    printf '\n'

    if [[ -z "$baseline" ]]; then
      printf '首次运行，已记录基线 `%s`。下次上游变化时生成差异。\n' "$target"
      return 0
    fi

    if [[ "$baseline" == "$target" ]]; then
      printf '本次检查期间上游 master 无变化（`%s`）。\n' "$target"
      return 0
    fi

    printf '## 上游新增提交\n\n'
    if [[ "$rewritten" == 1 ]]; then
      printf '> 基线不是上游当前提交的祖先（可能发生了 force-push / 历史重写），以下只列当前最近 30 条。\n\n'
      "${GIT[@]}" log --oneline --no-decorate -n 30 "$target"
    else
      printf '```\n'
      "${GIT[@]}" log --oneline --no-decorate "$range"
      printf '```\n'
    fi
    printf '\n## 变更规模（上游基线 → 上游当前）\n\n```\n'
    "${GIT[@]}" diff --stat "$baseline" "$target"
    printf '```\n\n## 全部变更文件及本地状态\n\n'
    printf '| # | 文件 | 变更 | 本地状态 |\n|---|------|------|----------|\n'
    local i=0 path status
    local -A status_of=()
    while IFS= read -r path; do
      [[ -z "$path" ]] && continue
      status_of["$path"]="$(local_status "$path" "$target")"
    done < <(printf '%s\n' "${changed[@]:-}")
    while IFS= read -r path; do
      [[ -z "$path" ]] && continue
      i=$((i + 1))
      status="${status_of[$path]}"
      printf '| %d | `%s` | %s | %s |\n' "$i" "$path" \
        "$("${GIT[@]}" diff --name-status "$baseline" "$target" -- "$path" | awk '{print $1}')" "$status"
    done < <(printf '%s\n' "${changed[@]:-}")

    printf '\n## 重点关注：本地已偏离或缺失的文件\n\n'
    local flagged=0
    while IFS= read -r path; do
      [[ -z "$path" ]] && continue
      status="${status_of[$path]}"
      if [[ "$status" == *"本地已偏离"* || "$status" == *"本地无此文件"* ]]; then
        flagged=$((flagged + 1))
        printf -- '- `%s` — %s\n' "$path" "$status"
      fi
    done < <(printf '%s\n' "${changed[@]:-}")
    if [[ "$flagged" == 0 ]]; then printf '无（本次上游变更的文件与本地内容一致）。\n'; fi

    printf '\n## 查看具体改动（只读命令）\n\n```bash\n'
    printf 'git -C %q diff %s %s\n' "$REPO_DIR" "$baseline" "$target"
    printf 'git -C %q log --oneline --no-decorate %s\n' "$REPO_DIR" "${range:-$target}"
    printf '```\n'
  } >"$report"

  log "报告已生成: ${report#"$REPO_DIR"/}"
  cp "$report" "$WATCH_DIR/latest.md"
}

ensure_baseline() {
  local sha="$1"
  [[ -z "$sha" ]] && { printf ''; return 0; }
  if "${GIT[@]}" cat-file -e "${sha}^{commit}" 2>/dev/null; then
    printf '%s' "$sha"
  else
    log "基线 $sha 不在本地对象库，改用 refs/remotes/upstream/master"
    printf '%s' "$prev_ref"
  fi
}

now="$(date '+%F %T %Z')"

if [[ "$MODE" == daily ]]; then
  if [[ -z "$LAST_SEEN_SHA" && -n "$prev_ref" ]]; then
    LAST_SEEN_SHA="$prev_ref"
    note="首次运行，基线取本地已有的 refs/remotes/upstream/master（$prev_ref）。"
  else
    note=""
  fi

  if [[ -n "$LAST_SEEN_SHA" && "$LAST_SEEN_SHA" == "$remote_sha" ]]; then
    if [[ "$state_existed" == 0 ]]; then
      LAST_SEEN_SHA="$remote_sha"
      LAST_SEEN_AT="$now"
      write_state
      log "已建立基线：$remote_sha"
    else
      log "无变化：upstream/master=$remote_sha"
    fi
    exit 0
  fi

  baseline="$(ensure_baseline "$LAST_SEEN_SHA")"
  report="$REPORTS_DIR/daily-$(date '+%F-%H%M%S').md"
  write_report daily "$baseline" "$remote_sha" "$report" "$note"

  LAST_SEEN_SHA="$remote_sha"
  LAST_SEEN_AT="$now"
  write_state
  log "基线已更新: $remote_sha"
  exit 0
fi

# weekly：固定出周报，即使无变化
weekly_baseline="$WEEKLY_BASELINE_SHA"
if [[ -z "$weekly_baseline" ]]; then
  weekly_baseline="$LAST_SEEN_SHA"
fi
if [[ -z "$weekly_baseline" && -n "$prev_ref" && "$prev_ref" != "$remote_sha" ]]; then
  weekly_baseline="$prev_ref"
fi
weekly_baseline="$(ensure_baseline "$weekly_baseline")"

week_checks=0
if [[ -f "$RUN_LOG" ]]; then
  cutoff="$(date -d '7 days ago' '+%F %T')"
  week_checks="$(awk -v c="$cutoff" 'substr($0,2,19) >= c && /\[daily\]/' "$RUN_LOG" | wc -l)"
fi

report="$REPORTS_DIR/weekly-$(date '+%G-W%V').md"
write_report weekly "$weekly_baseline" "$remote_sha" "$report" \
  "本周 run.log 记录的 daily 检查次数：$week_checks 次。"

WEEKLY_BASELINE_SHA="$remote_sha"
WEEKLY_BASELINE_AT="$now"
if [[ "$LAST_SEEN_SHA" != "$remote_sha" ]]; then
  LAST_SEEN_SHA="$remote_sha"
  LAST_SEEN_AT="$now"
fi
write_state
log "周基线已更新: $remote_sha"
