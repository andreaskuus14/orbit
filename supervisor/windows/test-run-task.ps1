# Test runner side (the "ORBIT Test Runner" task, the orbit-test account): run the request the supervisor named in run\current.json.
# test-run.ts builds the tests' environment from nothing and checks the request again.
$ErrorActionPreference = "Continue" # node writes test output to stderr; the result file is what counts
$sup = "C:\ProgramData\orbit-supervisor"
$r = Get-Content -LiteralPath "C:\orbit-test\run\current.json" -Raw | ConvertFrom-Json
$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node --no-warnings --experimental-strip-types "$sup\app\test-run.ts" $r.req $r.bundle "$sup\mirror.git" "C:\orbit-test\work" $r.modules $r.out *> "C:\orbit-test\work\last-run.log"
exit $LASTEXITCODE
