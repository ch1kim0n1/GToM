#compdef gtom
_gtom() {
  local -a commands options
  commands=('ingest' 'score' 'audit' 'vulnerabilities' 'health' 'eval' 'replay' 'regress' 'receipts' 'diff' 'trend' 'drift' 'decay' 'reset' 'cost' 'completion')
  options=('--json' '--quiet' '--cycles' '--budget-usd' '--gbrain' '--help')
  if (( CURRENT == 2 )); then
    _describe 'command' commands
  else
    _describe 'option' options
  fi
}
compdef _gtom gtom
