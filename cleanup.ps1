$file = 'index.html'
$lines = Get-Content $file
# Keep lines 1-867 and 1537-end (0-indexed: 0-866 and 1536+)
$keep = $lines[0..866] + $lines[1536..($lines.Count - 1)]
Set-Content $file -Value $keep
Write-Host "Done. Total lines: $($keep.Count)"
