#Requires -Version 7.0
# Shared command text helpers for the PowerShell hooks, the twin of command-text.sh.
# Dot-source it from a hook: . "$PSScriptRoot/command-text.ps1"
#
# A hook matches a call only at a command position. Prose that names a command
# is not a call, so heredoc bodies and quoted spans drop out first. Each command
# line becomes one output line, so every newline between them is a separator.

Set-StrictMode -Version 3.0

# Returns what the shell would run, with every heredoc body and quoted span gone,
# and every command line followed by ";". One scanner reads the text character by
# character, so quotes, escapes and heredoc openers all read the same state. A
# heredoc opener found inside a quoted span is prose, and a body starts only
# once the command line ends. With -QuotedTokens, quoted text stays, with its
# shell separators turned into spaces, so routing can read quoted arguments.
function ConvertTo-CommandCode([string]$Command, [switch]$QuotedTokens) {
  # The shell reads the text as lines; a trailing newline adds no empty line.
  $text = "$Command`n"
  $lines = $text.Split("`n")
  $lines = @($lines | Select-Object -SkipLast 1)

  $result = [System.Text.StringBuilder]::new()
  $held = [System.Text.StringBuilder]::new()
  $quote = 0 # 0 none, 1 single quoted, 2 double quoted
  $inBody = $false
  $marker = ''
  $pending = ''
  $separators = ';|&()'

  foreach ($line in $lines) {
    if ($inBody) {
      if ($line -cmatch ('^\s*' + $marker + '\s*$')) { $inBody = $false }
      continue
    }
    $continued = $false
    $length = $line.Length
    $index = 0
    while ($index -lt $length) {
      $char = $line[$index]
      if ($quote -eq 1) {
        # A single quoted span takes no escapes.
        if ($char -ceq "'") { $quote = 0 }
        elseif ($QuotedTokens) { [void]$held.Append($(if ($separators.Contains($char)) { ' ' } else { $char })) }
        $index++
        continue
      }
      if ($char -ceq '\') {
        # A backslash escapes the next character. At the end of the line it
        # joins the next line instead.
        if ($index -eq $length - 1) { $continued = $true }
        $index += 2
        continue
      }
      if ($quote -eq 2) {
        if ($char -ceq '"') { $quote = 0 }
        elseif ($QuotedTokens) { [void]$held.Append($(if ($separators.Contains($char)) { ' ' } else { $char })) }
        $index++
        continue
      }
      if ($char -ceq "'") { $quote = 1; $index++; continue }
      if ($char -ceq '"') { $quote = 2; $index++; continue }
      $rest = $line.Substring($index)
      # A here string carries no body, so it must not open one.
      if ($rest.StartsWith('<<<', [StringComparison]::Ordinal)) { $index += 3; continue }
      if ($rest.StartsWith('<<', [StringComparison]::Ordinal)) {
        $opener = [regex]::Match($rest, '^<<-?\s*[''"]?[A-Za-z_][A-Za-z0-9_]*[''"]?')
        if ($opener.Success) {
          $index += $opener.Length
          $pending = ($opener.Value -creplace '^<<-?\s*', '') -creplace '[''"]', ''
          continue
        }
        $index += 2
        continue
      }
      [void]$held.Append($char)
      $index++
    }
    # A continuation or an open quoted span means the command line goes on.
    if ($continued -or $quote -ne 0) { continue }
    [void]$result.Append($held.ToString()).Append(';')
    [void]$held.Clear()
    if ($pending -ne '') { $marker = $pending; $pending = ''; $inBody = $true }
  }
  if ($held.Length -gt 0) { [void]$result.Append($held.ToString()).Append(';') }
  return $result.ToString()
}
