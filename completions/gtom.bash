_gtom_completion() {
  local cur commands options
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  commands="ingest score audit vulnerabilities health eval replay regress receipts diff trend drift decay reset cost completion"
  options="--json --quiet --cycles --budget-usd --gbrain --help"
  if [[ ${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commands}" -- "${cur}") )
  else
    COMPREPLY=( $(compgen -W "${options}" -- "${cur}") )
  fi
}
complete -F _gtom_completion gtom
