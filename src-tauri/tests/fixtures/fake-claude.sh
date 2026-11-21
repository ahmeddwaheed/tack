#!/bin/bash
expected='-p --safe-mode --output-format stream-json --verbose --no-session-persistence --tools  --disallowedTools Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Read,Glob,Grep,Task'
if [ "$*" != "$expected" ]; then
  echo "unexpected arguments: $*" >&2
  exit 2
fi
prompt=$(cat)
init='{"type":"system","subtype":"init","cwd":"/tmp/x","session_id":"00000000-0000-0000-0000-000000000000","tools":[],"model":"claude-test","permissionMode":"default","apiKeySource":"none","uuid":"00000000-0000-0000-0000-000000000001"}'
assistant() {
  printf '{"type":"assistant","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[{"type":"text","text":"%s"}],"stop_reason":null},"parent_tool_use_id":null,"session_id":"00000000-0000-0000-0000-000000000000","uuid":"00000000-0000-0000-0000-000000000002"}\n' "$1"
}
result() {
  printf '{"type":"result","subtype":"success","is_error":%s,"duration_ms":10,"num_turns":1,"result":"%s","session_id":"00000000-0000-0000-0000-000000000000","total_cost_usd":0,"uuid":"00000000-0000-0000-0000-000000000003"}\n' "$1" "$2"
}
case "${FAKE_CLAUDE_MODE:-success}" in
  success)
    echo "$init"
    assistant "Hello"
    echo '{"type":"rate_limit_event","rate_limit_info":{},"session_id":"00000000-0000-0000-0000-000000000000","uuid":"00000000-0000-0000-0000-000000000004"}'
    result false "Rewritten: $prompt"
    ;;
  login)
    echo "$init"
    result true "Invalid API key · Please run /login"
    exit 1
    ;;
  crash)
    echo "boom" >&2
    exit 3
    ;;
  cwd)
    result false "$(pwd -P) $(ls -A | wc -l | tr -d ' ')"
    ;;
  burst)
    for i in $(seq 1 40); do assistant "x"; done
    result false "done"
    ;;
  helper)
    sleep 1000 >/dev/null 2>&1 &
    echo $! > "$FAKE_CLAUDE_PIDFILE"
    echo "$init"
    result false "done"
    ;;
  sleep)
    sleep 1000 &
    echo $! > "$FAKE_CLAUDE_PIDFILE"
    wait
    ;;
esac
