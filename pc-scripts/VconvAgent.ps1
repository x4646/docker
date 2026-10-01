# VconvAgent.ps1
# Background agent for video web-conversion (remux/transcode), controlled from
# the webpage. Runs forever, idles while off, works while the webpage switch
# is on. No visible window when launched via VconvAgent_Launch.vbs.
#
# Priority: remux jobs first (near-instant, just copies the stream), then
# transcode jobs (slow, uses GPU encode - only one at a time, no point
# running these in parallel on a single GPU).
#
# SINGLE INSTANCE ONLY - separate lock from DtsScanAgent.ps1 (different job,
# can run alongside it, but not alongside a second copy of itself).

# 2026-09-30: -CpuOnly = second instance that only does libx264 (CPU) transcodes, taking jobs from the
# TAIL of the server queue while the normal (GPU) instance takes from the head. It uses its own lock,
# so it can run next to the GPU instance. Start it with low priority, e.g.:
#   powershell -NoProfile -ExecutionPolicy Bypass -File X:\docker\pc-scripts\VconvAgent.ps1 -CpuOnly
param([switch]$CpuOnly)

# Force UTF-8 for console I/O and process arguments passed to ffmpeg.exe -
# without this, Windows PowerShell 5.1 on a Chinese-locale system defaults to
# GBK (codepage 936), which cannot represent Korean/many other non-Chinese
# Unicode characters in filenames - they get mangled before ffmpeg even sees
# them, so the file gets written under a different (garbled) name than the
# one this script expects, and existence checks then fail even though the
# conversion itself succeeded (see chat history 2026-08-13).
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
try { chcp 65001 | Out-Null } catch {}

# 2026-08-21: NAS地址/端口/盘符映射统一从共享配置读取, 不再各脚本各写一份
# (见 data/nas-config.json, PC和NAS容器都能读到同一份 - PC端走X:盘SMB挂载读)
# try/catch兜底: 配置文件读取在某些执行上下文下可能失败(比如非交互式启动时X:盘还没就绪),
# 不加保护的话会导致后面所有变量(包括跟配置无关的)状态不对, 见DtsScanAgent.ps1同款问题
try {
    $Config = Get-Content "X:\docker\data\nas-config.json" -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
} catch {
    Write-Host "WARNING: failed to read data/nas-config.json ($($_.Exception.Message)), falling back to hardcoded defaults"
    $Config = [PSCustomObject]@{
        nas_ip = '192.168.0.3'
        ports  = [PSCustomObject]@{ nas_media = 3050 }
        share_map = @(@('/share/Person','P:'), @('/share/Bak','B:'), @('/share/Media','M:'), @('/share/Container','X:'))
    }
}
$NasBase  = "http://$($Config.nas_ip):$($Config.ports.nas_media)"
$ShareMap = @($Config.share_map | ForEach-Object { , @($_[0], $_[1]) })

# 2026-08-17: per-file conversion timeout, kill and skip if it takes too long
$ConversionTimeoutSec = 600
# 2026-08-22: nvenc (GPU) is hardware-accelerated and should either succeed fast
# or fail fast on a capability mismatch, so 600s is plenty and a timeout there
# really does mean something's stuck. The libx264 (CPU) fallback is a different
# story - confirmed on IMG_8381.MOV/IMG_8376.MOV (4K60 HEVC, 1.6GB, 264s long):
# CPU-encoding 4+ minutes of 4K60 under concurrent load with 5 other ffmpeg
# processes genuinely doesn't fit in 600s, it's not stuck, just slow. Give the
# CPU fallback attempt a much bigger budget instead of endlessly retrying.
$ConversionTimeoutSecCpuFallback = 2400
$TimeoutLogPath = Join-Path $PSScriptRoot "vconv_timeout_log.txt"
$PerfLogPath = Join-Path $PSScriptRoot "vconv_perf_log.csv"
$BatchSize = 5
$PollIntervalSec = 5

function ToWinPath($p) {
    foreach ($m in $ShareMap) {
        if ($p.StartsWith($m[0], [System.StringComparison]::OrdinalIgnoreCase)) {
            return $m[1] + $p.Substring($m[0].Length).Replace('/', '\')
        }
    }
    return $p.Replace('/', '\')
}

$LockFile = Join-Path $env:TEMP $(if ($CpuOnly) { "VconvAgent_cpu.lock" } else { "VconvAgent.lock" })
if (Test-Path $LockFile) {
    $oldPid = Get-Content $LockFile -ErrorAction SilentlyContinue
    $stillAlive = $false
    if ($oldPid) {
        try { $p = Get-Process -Id $oldPid -ErrorAction Stop; $stillAlive = $true } catch {}
    }
    if ($stillAlive) {
        Write-Host "ERROR: Another VconvAgent instance is already running (PID $oldPid). Exiting."
        exit 1
    }
}
Set-Content -Path $LockFile -Value $PID -Force

try {

$ffCheck = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffCheck) {
    Write-Host "ERROR: ffmpeg not found in PATH. Aborting."
    exit 1
}

function GetStatus {
    try { return Invoke-RestMethod -Uri "$NasBase/api/vconv/status" -Method Get -TimeoutSec 10 }
    catch { return $null }
}

function RunFfmpeg($ffArgsStr, $timeoutSec) {
    # Runs one ffmpeg attempt, returns @{ finished=bool; exitCode=int; text=string }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'ffmpeg'
    $psi.Arguments = $ffArgsStr
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()

    $finished = $proc.WaitForExit($timeoutSec * 1000)
    if (-not $finished) {
        try { $proc.Kill() } catch {}
        Start-Sleep -Milliseconds 500
        return @{ finished = $false; exitCode = -1; text = "" }
    }
    return @{ finished = $true; exitCode = $proc.ExitCode; text = ($stdoutTask.Result + $stderrTask.Result) }
}

# 2026-09-30: source video bitrate (bits/s), used to cap the transcode bitrate. Measured on the first
# finished files: h264_nvenc -cq 20 with no cap produced copies BIGGER than the source (+7% on one,
# ~2x on another), so a "transcode" cost extra disk instead of saving any. With -maxrate = source bitrate
# the copy can never be much larger than the original, while -cq still lets easy scenes use fewer bits.
# Returns 0 when it cannot be read (then no cap is applied, quality-only like before).
function GetSrcVideoBitrate($src) {
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = 'ffprobe'
        $psi.Arguments = "-v error -select_streams v:0 -show_entries stream=bit_rate:format=bit_rate -of default=nw=1:nk=1 `"$src`""
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true
        $p = New-Object System.Diagnostics.Process
        $p.StartInfo = $psi
        [void]$p.Start()
        $out = $p.StandardOutput.ReadToEnd()
        [void]$p.StandardError.ReadToEnd()
        [void]$p.WaitForExit(30000)
        $nums = @($out -split "`r?`n" | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [double]$_ })
        if ($nums.Count -ge 1 -and $nums[0] -gt 0) { return [long]$nums[0] }
    } catch {}
    return 0
}

function ConvertOne($item, $mode) {
    try {
        Invoke-RestMethod -Uri "$NasBase/api/vconv/current" -Method Post -Body (@{ path = $item.path; mode = $mode } | ConvertTo-Json) -ContentType "application/json; charset=utf-8" -TimeoutSec 10 | Out-Null
    } catch {}

    $src = ToWinPath($item.path)
    $dst = ToWinPath($item.convPath)
    $dstDir = Split-Path $dst -Parent
    New-Item -ItemType Directory -Force -Path $dstDir | Out-Null

    if ($mode -eq 'remux') {
        $attempts = @(
            "-y -i `"$src`" -map_metadata 0 -c copy -movflags +faststart `"$dst`""
        )
    } else {
        # 2026-08-21: h264_nvenc rejects 10-bit HEVC ("10 bit encode not supported")
        # and 4:2:2 chroma sources like ProRes ("YUV422P not supported") outright -
        # both show up as a misleading "No capable devices found". Forcing
        # -pix_fmt yuv420p makes ffmpeg normalize to 8-bit 4:2:0 before handing
        # frames to nvenc, which fixes the large majority of these. For whatever
        # nvenc still can't take (older/odd profiles), fall back to a slower CPU
        # libx264 encode so the file still gets a web-playable copy instead of
        # being marked permanently failed.
        # 2026-08-21: iPhone MOV files carry extra "data" streams (gyro/gravity/
        # timed-metadata tracks, codec_type=data) alongside video+audio. Without
        # an explicit -map, ffmpeg tries to also handle those in the output and
        # some combinations just hang until the timeout kills them (confirmed via
        # ffprobe on several of the timed-out files - small/short clips that have
        # no business taking anywhere near 600s to encode). Map only the first
        # video and first audio stream so those extra tracks are never touched.
        # 2026-08-22: some source files (found on two babybus episodes so far) have
        # corrupted audio channel-count metadata (ffprobe/ffmpeg reports e.g. "52
        # channels" for what's actually a normal stereo/mono track). ffmpeg's
        # resampler can't reconcile that with the aac stereo output and aborts
        # with "Rematrix is needed... but there is not enough information", which
        # kills the whole conversion (exit=-22) even though video decode/encode
        # completes fine - confirmed by reproducing standalone with full stderr.
        # -ac 2 forces the output channel count explicitly so the resampler never
        # has to trust the source's bogus channel metadata.
        # 2026-08-29: third fallback attempt - "tolerant mode". The first two
        # attempts (nvenc/libx264) assume the source file itself is intact and
        # only the codec is incompatible. But plenty of failures in the library
        # are actually genuinely damaged/incomplete source files (e.g. moov atom
        # missing from an interrupted download, or corruption partway through).
        # This attempt adds -err_detect ignore_err (don't stop on decode errors)
        # + discardcorrupt (drop unreadable packets instead of failing outright)
        # + igndts (keep going even if timestamps look wrong), to salvage
        # whatever is actually readable. Audio track is marked optional (?) so
        # video can still be salvaged even if the audio stream itself is dead.
        # Scope: this can rescue "corruption partway through the file" cases,
        # but NOT "moov atom entirely missing" (incomplete download - there's no
        # index at all, so ffmpeg has no way to locate frames) - that class needs
        # the source file re-fetched, not re-encoded.
        # cap bitrate at the source bitrate (see GetSrcVideoBitrate); no cap if it can not be read
        $srcBr = GetSrcVideoBitrate $src
        $rc = ''
        if ($srcBr -gt 0) { if ($srcBr -lt 800000) { $srcBr = 800000 }; $rc = "-maxrate $srcBr -bufsize $($srcBr * 2)" }
        $gpuAttempts = @(
            "-y -fflags +genpts -i `"$src`" -map 0:v:0 -map 0:a:0 -map_metadata 0 -pix_fmt yuv420p -c:v h264_nvenc -preset p5 -rc vbr -cq 24 -b:v 0 $rc -c:a aac -ac 2 -b:a 192k -movflags +faststart `"$dst`"",
            "-y -fflags +genpts -i `"$src`" -map 0:v:0 -map 0:a:0 -map_metadata 0 -pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 23 $rc -c:a aac -ac 2 -b:a 192k -movflags +faststart `"$dst`"",
            "-y -err_detect ignore_err -fflags +genpts+igndts+discardcorrupt -i `"$src`" -map 0:v:0 -map 0:a:0? -map_metadata 0 -pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 25 $rc -c:a aac -ac 2 -b:a 192k -movflags +faststart `"$dst`""
        )
        # CPU-only instance skips the nvenc attempt (index 0)
        $attempts = if ($CpuOnly) { @($gpuAttempts[1], $gpuAttempts[2]) } else { $gpuAttempts }
    }

    $lastResult = $null
    $lastArgs   = $null
    for ($i = 0; $i -lt $attempts.Count; $i++) {
        $lastArgs = $attempts[$i]
        # attempt 0 is nvenc (GPU, should be fast) - attempt 1+ is the libx264
        # CPU fallback, which needs a much bigger timeout budget for long 4K clips
        $thisTimeoutSec = if ($mode -eq 'transcode' -and ($i -gt 0 -or $CpuOnly)) { $ConversionTimeoutSecCpuFallback } else { $ConversionTimeoutSec }
        $lastResult = RunFfmpeg $lastArgs $thisTimeoutSec

        if (-not $lastResult.finished) {
            try {
                $logLine = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$mode] $($item.path) (over ${thisTimeoutSec}s, attempt $($i+1)/$($attempts.Count))"
                Add-Content -Path $TimeoutLogPath -Value $logLine -Encoding UTF8
            } catch {}
            try { if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue } } catch {}

            # 2026-08-23: a timeout used to fail the file immediately, even when a
            # slower fallback attempt (libx264 CPU, much bigger timeout budget) was
            # still available - so a nvenc GPU attempt that timed out at 600s on a
            # genuinely large 4K60/HEVC file never got the CPU fallback's chance to
            # actually finish within 2400s. Confirmed on the fail-list: most of the
            # 27 entries were exactly this ("Conversion timed out (over 600 sec)")
            # on files (iPhone 4K60 HEVC, old anime BD-rip mkv) that are otherwise
            # ordinary and likely just need more time. Only give up for real once
            # every attempt (including the CPU fallback) has been tried.
            if ($i -lt $attempts.Count - 1) {
                Write-Host "  TIMEOUT ($mode, attempt $($i+1)): $($item.path) - retrying with fallback encoder"
                continue
            }

            $timeoutMsg = "Conversion timed out (over $thisTimeoutSec sec), killed and skipped"
            try {
                Invoke-RestMethod -Uri "$NasBase/api/vconv/fail" -Method Post -Body (@{ md5 = $item.md5; error = $timeoutMsg } | ConvertTo-Json) -ContentType "application/json; charset=utf-8" -TimeoutSec 30 | Out-Null
            } catch {}
            Write-Host "  TIMEOUT ($mode): $($item.path) - skipped and logged to $TimeoutLogPath"
            return $false
        }

        $ok = $lastResult.exitCode -eq 0 -and (Test-Path -LiteralPath $dst) -and ((Get-Item -LiteralPath $dst).Length -gt 0)
        if ($ok) {
            try {
                Invoke-RestMethod -Uri "$NasBase/api/vconv/done" -Method Post -Body (@{ md5 = $item.md5; mode = $mode } | ConvertTo-Json) -ContentType "application/json; charset=utf-8" -TimeoutSec 30 | Out-Null
            } catch {}
            if ($i -gt 0) { Write-Host "  OK ($mode, fallback attempt $($i+1)): $($item.path)" }
            return $true
        }

        # attempt failed - clean up any partial output before retrying
        try { if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue } } catch {}
        if ($i -lt $attempts.Count - 1) {
            Write-Host "  attempt $($i+1) failed ($mode): $($item.path) - retrying with fallback encoder"
        }
    }

    $errText = ($lastResult.text | Out-String).Trim()
    if ($errText.Length -gt 1500) {
        # 2026-08-22: keeping only the tail loses the real error line when ffmpeg
        # (esp. libx264) prints a big per-frame stats dump after the actual error -
        # confirmed on IMG_0584.MOV, where the true failure reason was pushed out
        # by ~40 lines of encoder stats before "Conversion failed!". Keep head+tail.
        $errText = $errText.Substring(0, 800) + "`n...(truncated)...`n" + $errText.Substring($errText.Length - 700)
    }
    try {
        Invoke-RestMethod -Uri "$NasBase/api/vconv/fail" -Method Post -Body (@{ md5 = $item.md5; error = "exit=$($lastResult.exitCode) : $errText" } | ConvertTo-Json) -ContentType "application/json; charset=utf-8" -TimeoutSec 30 | Out-Null
    } catch {}
    Write-Host "  FAILED ($mode): $($item.path)"
    Write-Host "    exit=$($lastResult.exitCode) : $errText"
    return $false
}


$RoundKind = 'remux'   # alternates between 'remux' and 'transcode' each round,
                       # so both queues visibly progress instead of remux
                       # hogging all the time before transcode gets a turn

function RunOneRoundCpu {
    # take the LAST queued transcode job (GPU instance takes the first); ConvertOne reports /current
    # right away, which flips it to 'processing' on the server so nobody else gets it
    try { $r = Invoke-RestMethod -Uri "$NasBase/api/vconv/pending?mode=transcode&limit=500" -Method Get -TimeoutSec 30 } catch { $r = $null }
    if ($r -and $r.videos -and @($r.videos).Count -gt 0) {
        $list = @($r.videos)
        $item = $list[$list.Count - 1]
        Write-Host "Transcoding (CPU): $($item.path)"
        ConvertOne $item 'transcode' | Out-Null
        return $true
    }
    return $false
}

function RunOneRound {
    if ($CpuOnly) { return (RunOneRoundCpu) }
    $script:RoundKind = if ($script:RoundKind -eq 'remux') { 'transcode' } else { 'remux' }

    if ($script:RoundKind -eq 'remux') {
        try { $resp = Invoke-RestMethod -Uri "$NasBase/api/vconv/pending?mode=remux&limit=$BatchSize" -Method Get -TimeoutSec 30 } catch { $resp = $null }
        if ($resp -and $resp.videos -and @($resp.videos).Count -gt 0) {
            foreach ($item in @($resp.videos)) {
                Write-Host "Remuxing: $($item.path)"
                ConvertOne $item 'remux' | Out-Null
            }
            return $true
        }
        # remux queue empty this round - fall through to try transcode instead
    }

    try { $transResp = Invoke-RestMethod -Uri "$NasBase/api/vconv/pending?mode=transcode&limit=1" -Method Get -TimeoutSec 30 } catch { $transResp = $null }
    if ($transResp -and $transResp.videos -and @($transResp.videos).Count -gt 0) {
        $item = @($transResp.videos)[0]
        Write-Host "Transcoding: $($item.path)"
        ConvertOne $item 'transcode' | Out-Null
        return $true
    }

    # transcode queue also empty - last resort, drain any remaining remux work
    try { $resp2 = Invoke-RestMethod -Uri "$NasBase/api/vconv/pending?mode=remux&limit=$BatchSize" -Method Get -TimeoutSec 30 } catch { $resp2 = $null }
    if ($resp2 -and $resp2.videos -and @($resp2.videos).Count -gt 0) {
        foreach ($item in @($resp2.videos)) {
            Write-Host "Remuxing: $($item.path)"
            ConvertOne $item 'remux' | Out-Null
        }
        return $true
    }

    return $false   # nothing pending in either queue
}

Write-Host "=== VconvAgent started, idling until switched on from the webpage ==="

while ($true) {
    $status = GetStatus
    # 2026-08-17: heartbeat every loop iteration regardless of idle/active,
    # so the webpage can tell if this process is genuinely still alive
    try {
        Invoke-RestMethod -Uri "$NasBase/api/vconv/heartbeat" -Method Post -TimeoutSec 10 | Out-Null
    } catch {}
    if ($status -and $status.running) {
        $did = RunOneRound
        if (-not $did) {
            Write-Host "Nothing pending. Idling."
            Start-Sleep -Seconds $PollIntervalSec
        }
    } else {
        Start-Sleep -Seconds $PollIntervalSec
    }
}


} finally {
    Remove-Item -Path $LockFile -Force -ErrorAction SilentlyContinue
}
