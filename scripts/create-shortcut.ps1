# create-shortcut.ps1 — tworzy skrót na pulpicie uruchamiający aplikację
# Uruchom ten skrypt raz na nowej maszynie

$AppDir = $PSScriptRoot | Split-Path -Parent
$StartScript = Join-Path $PSScriptRoot "start-app.ps1"
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath "Grzesiu ecom.lnk"

# Znajdź ikonę przeglądarki (Edge lub Chrome)
$IconPath = ""
$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (Test-Path $edgePath) {
    $IconPath = $edgePath
} elseif (Test-Path $chromePath) {
    $IconPath = $chromePath
}

$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""
$shortcut.WorkingDirectory = $AppDir
$shortcut.Description = "Uruchom Grzesiu ecom (localhost:3000)"
if ($IconPath) {
    $shortcut.IconLocation = "$IconPath,0"
}
$shortcut.WindowStyle = 7  # 7 = minimized
$shortcut.Save()

Write-Host "Skrót utworzony: $ShortcutPath"
Write-Host "Kliknij dwukrotnie '$ShortcutPath' żeby uruchomić aplikację."
