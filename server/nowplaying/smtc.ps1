# Vayro "Now Playing" helper (Windows only).
#
# Reads what the computer is playing from Windows' media session (the same information shown in
# the volume pop-up / lock screen): app, title, artist, album, playing/paused, position, length.
# It never touches the audio. Prints one JSON line about every 400 ms on stdout, and accepts
# commands on stdin, one per line: toggle | play | pause | next | prev | seek <seconds>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($op, [Type]$type) {
  $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$t.Wait(3000)
  if ($t.IsCompleted) { return $t.Result }
  return $null
}

[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$MgrT = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$PropsT = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($MgrT::RequestAsync()) $MgrT
if (-not $mgr) { Write-Output '{"error":"media session unavailable"}'; exit 1 }

# [Console]::In is a synchronised reader whose ReadLineAsync blocks; a StreamReader over the raw
# stdin stream reads in the background, so the loop keeps reporting while waiting for commands
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$lastKey = ''
$props = $null

while ($true) {
  # "Sync lyrics" is about Spotify: follow the Spotify app whenever it's open, even if a browser
  # video is the "current" media; otherwise whatever Windows says is playing
  $s = $null
  foreach ($x in $mgr.GetSessions()) { if ($x.SourceAppUserModelId -match 'Spotify') { $s = $x; break } }
  if (-not $s) { $s = $mgr.GetCurrentSession() }

  # --- commands from the server ---
  while ($pending.IsCompleted) {
    $line = $pending.Result
    if ($null -eq $line) { exit 0 } # server went away
    $pending = $stdin.ReadLineAsync()
    if (-not $s) { continue }
    $parts = $line.Trim().Split(' ')
    switch ($parts[0]) {
      'toggle' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
      'play'   { [void](Await ($s.TryPlayAsync()) ([bool])) }
      'pause'  { [void](Await ($s.TryPauseAsync()) ([bool])) }
      'next'   { [void](Await ($s.TrySkipNextAsync()) ([bool])) }
      'prev'   { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }
      'seek'   {
        $ticks = [long]([double]::Parse($parts[1], [Globalization.CultureInfo]::InvariantCulture) * 10000000)
        [void](Await ($s.TryChangePlaybackPositionAsync($ticks)) ([bool]))
      }
    }
  }

  if (-not $s) {
    Write-Output '{"none":true}'
  } else {
    try {
      $pb = $s.GetPlaybackInfo()
      $tl = $s.GetTimelineProperties()
      # media properties only change with the song: refresh them when the app's timeline resets,
      # and at least every few seconds
      $key = "$($s.SourceAppUserModelId)|$($tl.EndTime.Ticks)"
      if (-not $props -or $key -ne $lastKey -or ((Get-Date) - $propsAt).TotalSeconds -gt 2) {
        $p = Await ($s.TryGetMediaPropertiesAsync()) $PropsT
        if ($p) { $props = $p; $propsAt = Get-Date; $lastKey = $key }
      }
      $o = [ordered]@{
        app      = $s.SourceAppUserModelId
        title    = $props.Title
        artist   = $props.Artist
        album    = $props.AlbumTitle
        status   = $pb.PlaybackStatus.ToString()
        position = $tl.Position.TotalSeconds
        start    = $tl.StartTime.TotalSeconds
        end      = $tl.EndTime.TotalSeconds
        updated  = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
        now      = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      }
      Write-Output ($o | ConvertTo-Json -Compress)
    } catch {
      Write-Output ('{"error":' + ($_.Exception.Message | ConvertTo-Json -Compress) + '}')
    }
  }
  Start-Sleep -Milliseconds 400
}
