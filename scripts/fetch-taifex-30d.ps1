# 期交所「前 30 個交易日每筆成交」每日存檔。
# 免費窗只有 30 天，會滾動消失——每天（或至少每兩週）跑一次，本地累積就能超過 30 天。
# 原始 zip / tick 不進 git（.gitignore 已排除 data/taifex-30d/）；聚合 1 分 K 由 h01-real1m.ts 產出。
# 用法：powershell -File scripts/fetch-taifex-30d.ps1
$dir = Join-Path $PSScriptRoot "..\data\taifex-30d"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$ok = 0
for ($k = 0; $k -le 46; $k++) {
  $d = (Get-Date).AddDays(-$k)
  $tag = $d.ToString("yyyy_MM_dd")
  $out = Join-Path $dir "Daily_$tag.zip"
  if (Test-Path $out) { continue }
  try {
    Invoke-WebRequest -Uri "https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/Daily_$tag.zip" `
      -Headers @{ "User-Agent" = "Mozilla/5.0" } -OutFile $out -ErrorAction Stop
    $b = [System.IO.File]::ReadAllBytes($out)[0..1]
    if ($b[0] -ne 80 -or $b[1] -ne 75) { Remove-Item $out } else { $ok++ }  # 非 PK 魔數＝假日的 HTML 錯誤頁
  } catch { if (Test-Path $out) { Remove-Item $out } }
  Start-Sleep -Milliseconds 400
}
Write-Host "new zips: $ok"
# 解壓＋過濾出 TX 瘦檔（tick 全欄位是 ASCII，僅表頭是 Big5，可安全用 oem 讀）
$tmp = Join-Path $env:TEMP "taifex_x"
foreach ($z in (Get-ChildItem "$dir\Daily_*.zip")) {
  $tag = $z.BaseName -replace "Daily_", ""
  $slim = Join-Path $dir "tx_$tag.csv"
  if (Test-Path $slim) { continue }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -Path $z.FullName -DestinationPath $tmp -Force
  $csv = (Get-ChildItem "$tmp\*.csv")[0].FullName
  Select-String -Path $csv -Pattern '^\d{8},TX\s' -Encoding oem |
    ForEach-Object { $_.Line } | Set-Content $slim -Encoding Ascii
}
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "slim files: $((Get-ChildItem "$dir\tx_*.csv").Count)"
